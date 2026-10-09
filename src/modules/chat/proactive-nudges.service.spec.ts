import { ProactiveNudgesService } from './proactive-nudges.service';
import { ChiomaApiClient } from '../../integrations/chioma-api/chioma-api.client';
import { SessionStore } from '../../agent/memory/session-store.interface';

describe('ProactiveNudgesService', () => {
  const sessionId = 'session-for-owner';
  const accessToken = 'test-token';
  const dueDate = () => new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

  function setup() {
    const appendMessages = jest.fn().mockResolvedValue(undefined);
    const getNotifications = jest.fn().mockResolvedValue([
      { notificationId: 'rent-1', type: 'rent_due', message: 'private details', urgency: 'urgent', dueDate: dueDate() },
      { notificationId: 'other-1', type: 'maintenance', message: 'irrelevant', urgency: 'normal', dueDate: dueDate() },
    ]);
    const store = { appendMessages } as unknown as SessionStore;
    const api = { getNotifications } as unknown as ChiomaApiClient;
    return { service: new ProactiveNudgesService(api, store), appendMessages, getNotifications };
  }

  it('does not poll or write when no session explicitly opts in', async () => {
    const { service, appendMessages, getNotifications } = setup();
    await service.poll();
    expect(getNotifications).not.toHaveBeenCalled();
    expect(appendMessages).not.toHaveBeenCalled();
  });

  it('delivers an eligible notice once to only the opted-in session', async () => {
    const { service, appendMessages, getNotifications } = setup();
    service.setEnabled(sessionId, accessToken, true);
    await service.poll();
    await service.poll();
    expect(getNotifications).toHaveBeenCalledTimes(2);
    expect(getNotifications).toHaveBeenCalledWith(accessToken, 'all', 'all');
    expect(appendMessages).toHaveBeenCalledTimes(1);
    expect(appendMessages).toHaveBeenCalledWith(sessionId, [
      { role: 'assistant', content: expect.stringContaining('rent payment') },
    ]);
    expect(JSON.stringify(appendMessages.mock.calls)).not.toContain(accessToken);
    expect(JSON.stringify(appendMessages.mock.calls)).not.toContain('private details');
  });

  it('stops all polling after opt-out', async () => {
    const { service, appendMessages, getNotifications } = setup();
    service.setEnabled(sessionId, accessToken, true);
    service.setEnabled(sessionId, accessToken, false);
    await service.poll();
    expect(getNotifications).not.toHaveBeenCalled();
    expect(appendMessages).not.toHaveBeenCalled();
  });

  it('never writes a disputed, past or unrelated alert without a due condition', async () => {
    const { service, appendMessages, getNotifications } = setup();
    getNotifications.mockResolvedValue([
      { notificationId: 'out-of-window', type: 'rent_due', urgency: 'urgent',
        dueDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString() },
      { notificationId: 'unknown', type: 'unknown', urgency: 'critical', dueDate: dueDate() },
    ]);
    service.setEnabled(sessionId, accessToken, true);
    await service.poll();
    expect(appendMessages).not.toHaveBeenCalled();
  });

  it('retains an eligible notice after a failed session-store append', async () => {
    const { service, appendMessages } = setup();
    appendMessages.mockRejectedValueOnce(new Error('temporary store issue'));
    service.setEnabled(sessionId, accessToken, true);
    await service.poll();
    await service.poll();
    expect(appendMessages).toHaveBeenCalledTimes(2);
  });
});
