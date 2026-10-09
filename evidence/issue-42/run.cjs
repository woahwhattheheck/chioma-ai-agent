#!/usr/bin/env node
'use strict';
// Focused offline execution of the real TypeScript classes, not an HTTP/e2e run.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const DAY = 86400000;
const servicePath = path.join(root, 'src/modules/chat/proactive-nudges.service.ts');
const controllerPath = process.env.CONTROLLER_SOURCE || path.join(root, 'src/modules/chat/chat.controller.ts');
const sourceHash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const tests = [];
function check(name, body) { tests.push({ name, body }); }
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

function setup() {
  let now = Date.parse('2026-10-09T06:00:00Z');
  let callback, intervalMs, unref = false, cleared = false;
  class Clock extends Date { static now() { return now; } }
  const decorator = () => () => undefined;
  const nest = {
    BadRequestException: class extends Error {}, UnauthorizedException: class extends Error {},
    HttpStatus: { NO_CONTENT: 204 },
    Injectable: decorator, Inject: decorator, Controller: decorator, Post: decorator,
    Delete: decorator, Body: decorator, Headers: decorator, Param: decorator, HttpCode: decorator,
  };
  const imports = {
    '@nestjs/common': nest,
    '../../agent/memory/session-store.interface': { SESSION_STORE: Symbol('SESSION_STORE') },
    '../../agent/conversation/conversation.service': { ConversationService: { newSessionId: () => 'fixture-session' } },
    crypto,
  };
  function load(file) {
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
      reportDiagnostics: true,
    });
    const errors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
    assert.deepEqual(errors, [], 'TypeScript transpilation diagnostics');
    const exports = {};
    vm.runInNewContext(compiled.outputText, {
      exports, Date: Clock,
      require(name) { assert.ok(Object.hasOwn(imports, name), `unexpected dependency ${name}`); return imports[name]; },
      setInterval(fn, ms) { callback = fn; intervalMs = ms; return { unref() { unref = true; } }; },
      clearInterval() { cleared = true; },
    }, { filename: file, timeout: 1000 });
    return exports;
  }
  const { NotificationPreferencesStore } = load(path.join(root, 'src/agent/memory/notification-preferences.store.ts'));
  imports['../../agent/memory/notification-preferences.store'] = { NotificationPreferencesStore };
  imports['../agent/memory/notification-preferences.store'] = { NotificationPreferencesStore };
  const preferences = new NotificationPreferencesStore();
  const { SetNotificationPreferencesTool } = load(path.join(root, 'src/tools/notifications.tool.ts'));
  const { ProactiveNudgesService } = load(servicePath);
  imports['./proactive-nudges.service'] = { ProactiveNudgesService };
  const { ChatController } = load(controllerPath);
  const calls = [], writes = [];
  const notice = (id, type, days = 2) => ({ notificationId: id, type, dueDate: new Date(now + days * DAY).toISOString(), urgency: 'normal', message: 'PRIVATE-FIXTURE' });
  const api = { async getNotifications(...args) { calls.push(args); return [notice('rent', 'rent_due'), notice('draft', 'draft_expiring'), notice('dispute', 'dispute_deadline')]; } };
  const store = { async appendMessages(id, messages) { writes.push({ id, messages }); } };
  const conversation = { async resetSession() {}, async handleTurn() { return 'reply'; } };
  api.setNotificationPreferences = async (_token, requested) => ({ saved: true, ...requested });
  const preferencesTool = new SetNotificationPreferencesTool(api, preferences);
  const service = new ProactiveNudgesService(api, store, preferences);
  const controller = new ChatController(conversation, service);
  return { service, controller, api, store, conversation, calls, writes, notice, preferences, preferencesTool,
    advance(ms) { now += ms; }, timer() { return { callback, intervalMs, unref, cleared }; } };
}

check('default opt-out makes no API calls; invalid preferences rejected', async () => {
  const f = setup(); await f.service.poll();
  assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0);
  assert.throws(() => f.controller.updateNudges('s', { enabled: 'true' }, 'Bearer fixture-A'), /boolean/);
  assert.throws(() => f.controller.updateNudges('s', { enabled: true }), /Missing bearer/);
});
check('six-hour scheduler delivers rent, draft and dispute notices; lifecycle clears it', async () => {
  const f = setup(); f.controller.updateNudges('s', { enabled: true }, 'Bearer fixture-A');
  f.service.onModuleInit();
  assert.equal(f.timer().intervalMs, 6 * 60 * 60 * 1000); assert.equal(f.timer().unref, true);
  f.timer().callback(); await new Promise(setImmediate);
  assert.equal(f.writes.length, 3);
  const text = JSON.stringify(f.writes);
  for (const label of ['rent payment', 'lease draft', 'dispute response']) assert.ok(text.includes(label));
  assert.equal(text.includes('fixture-A'), false); assert.equal(text.includes('PRIVATE-FIXTURE'), false);
  f.service.onModuleDestroy(); assert.equal(f.timer().cleared, true);
  await f.service.poll(); assert.equal(f.calls.length, 1);
});
check('same client session ID stays owner-scoped; opt-out affects only its owner', async () => {
  const f = setup();
  f.controller.updateNudges('shared', { enabled: true }, 'Bearer fixture-A');
  f.controller.updateNudges('shared', { enabled: true }, 'Bearer fixture-B');
  f.controller.updateNudges('shared', { enabled: false }, 'Bearer fixture-A');
  await f.service.poll(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], 'fixture-B');
  const owner = crypto.createHash('sha256').update('fixture-B').digest('hex').slice(0, 16);
  assert.ok(f.writes.every(w => w.id === `${owner}:shared`));
});
check('opt-out during pending fetch suppresses delivery; overlapping poll is skipped', async () => {
  const f = setup(), pending = deferred(); let fetches = 0;
  f.api.getNotifications = async () => { fetches++; return pending.promise; };
  f.service.setEnabled('s', 'fixture-A', true); const poll = f.service.poll();
  await f.service.poll(); assert.equal(fetches, 1);
  f.service.setEnabled('s', 'fixture-A', false);
  pending.resolve([f.notice('rent', 'rent_due')]); await poll;
  assert.equal(f.writes.length, 0);
});
check('expired opt-in and out-of-window notices do not deliver', async () => {
  const f = setup(); f.service.setEnabled('s', 'fixture-A', true);
  f.advance(DAY); f.service.refresh('s', 'fixture-A'); await f.service.poll();
  assert.equal(f.calls.length, 0);
  f.service.setEnabled('s', 'fixture-A', true);
  f.api.getNotifications = async () => [f.notice('future', 'rent_due', 20), f.notice('past', 'dispute_due', -2), f.notice('other', 'maintenance')];
  await f.service.poll(); assert.equal(f.writes.length, 0);
});
check('failed append retries once successfully, then deduplicates', async () => {
  const f = setup(); let attempts = 0;
  f.api.getNotifications = async () => [f.notice('rent', 'rent_due')];
  f.store.appendMessages = async () => { if (++attempts === 1) throw new Error('fixture failure'); };
  f.service.setEnabled('s', 'fixture-A', true);
  await f.service.poll(); await f.service.poll(); await f.service.poll();
  assert.equal(attempts, 2);
});
check('session reset cancels pending notification before awaiting store deletion', async () => {
  const f = setup(), backend = deferred(), deletion = deferred();
  f.api.getNotifications = () => backend.promise;
  f.conversation.resetSession = () => deletion.promise;
  f.controller.updateNudges('s', { enabled: true }, 'Bearer fixture-A');
  const poll = f.service.poll();
  const reset = f.controller.resetSession('s', 'Bearer fixture-A');
  backend.resolve([f.notice('rent', 'rent_due')]); await poll;
  const writesDuringReset = f.writes.length;
  deletion.resolve(); await reset;
  assert.equal(writesDuringReset, 0, 'a nudge must not start while reset is awaiting deletion');
});

check('existing preference tool filters categories and cancels a pending fetch on opt-out', async () => {
  const f = setup(); f.service.setEnabled('s', 'fixture-A', true);
  await f.preferencesTool.execute({ channels: ['in_app'], categories: { rent_reminders: false } }, { accessToken: 'fixture-A' });
  await f.service.poll(); assert.equal(f.writes.length, 2);
  assert.equal(JSON.stringify(f.writes).includes('rent payment'), false);
  const g = setup(), backend = deferred();
  g.api.getNotifications = () => backend.promise;
  g.service.setEnabled('s', 'fixture-A', true); const poll = g.service.poll();
  await g.preferencesTool.execute({ channels: [] }, { accessToken: 'fixture-A' });
  backend.resolve([g.notice('rent', 'rent_due')]); await poll;
  assert.equal(g.writes.length, 0);
});
check('failed preference save cannot enable nudges; saved overnight quiet hours are respected', async () => {
  const f = setup(); f.service.setEnabled('s', 'fixture-A', true);
  await f.preferencesTool.execute({ channels: [] }, { accessToken: 'fixture-A' });
  f.api.setNotificationPreferences = async () => ({ saved: false });
  await f.preferencesTool.execute({ channels: ['in_app'] }, { accessToken: 'fixture-A' });
  await f.service.poll(); assert.equal(f.writes.length, 0);
  f.api.setNotificationPreferences = async (_token, requested) => ({ saved: true, ...requested });
  await f.preferencesTool.execute({ channels: ['in_app'], quietHours: { startTime: '22:00', endTime: '07:00', timezone: 'UTC' } }, { accessToken: 'fixture-A' });
  await f.service.poll(); assert.equal(f.writes.length, 0);
  f.advance(60 * 60 * 1000); await f.service.poll(); assert.equal(f.writes.length, 3);
});

(async () => {
  console.log('Chioma issue #42 | focused offline source execution');
  console.log(`Runtime: ${process.version}; TypeScript: ${ts.version}`);
  console.log(`service SHA256: ${sourceHash(servicePath)}`);
  console.log(`controller SHA256: ${sourceHash(controllerPath)}`);
  console.log(`preferences SHA256: ${sourceHash(path.join(root, 'src/agent/memory/notification-preferences.store.ts'))}`);
  console.log(`tool SHA256: ${sourceHash(path.join(root, 'src/tools/notifications.tool.ts'))}`);
  console.log('Mocks: API, session store, Nest decorators, test clock and timer. No live network.');
  let failures = 0;
  for (const test of tests) {
    try { await test.body(); console.log(`PASS ${test.name}`); }
    catch (error) { failures++; console.log(`FAIL ${test.name}\n  ${error.message}`); }
  }
  console.log(`Result: ${tests.length - failures}/${tests.length} passed; ${failures} failed`);
  console.log('Not a full Nest build, HTTP integration run, or sponsor acceptance decision.');
  process.exitCode = failures ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
