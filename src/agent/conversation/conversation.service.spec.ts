import { ConversationService } from './conversation.service';
import { Logger } from '@nestjs/common';
import { LlmProvider } from '../llm/llm-provider.interface';
import { LlmCompletionRequest, LlmCompletionResult } from '../llm/llm.types';
import { SessionStore } from '../memory/session-store.interface';
import { ToolRegistry } from '../../tools/tools.registry';
import { InMemorySessionStore } from '../memory/in-memory-session-store';

describe('ConversationService', () => {
  let sessionStore: SessionStore;

  beforeEach(() => {
    sessionStore = new InMemorySessionStore();
  });

  function makeToolRegistry(executeResult = 'tool output') {
    const execute = jest.fn<
      Promise<string>,
      Parameters<ToolRegistry['execute']>
    >();
    execute.mockResolvedValue(executeResult);
    const getDefinitions = jest.fn<
      ReturnType<ToolRegistry['getDefinitions']>,
      []
    >();
    getDefinitions.mockReturnValue([]);
    const toolRegistry = { getDefinitions, execute } as unknown as ToolRegistry;
    return { toolRegistry, execute, getDefinitions };
  }

  function makeLlmProvider() {
    const complete = jest.fn<
      Promise<LlmCompletionResult>,
      [LlmCompletionRequest]
    >();
    const llmProvider: LlmProvider = { complete };
    return { llmProvider, complete };
  }

  it('returns the assistant reply directly when no tool call is made', async () => {
    const { llmProvider, complete } = makeLlmProvider();
    complete.mockResolvedValue({
      message: { role: 'assistant', content: 'Hello there' },
      stopReason: 'stop',
    });
    const { toolRegistry, execute } = makeToolRegistry();
    const service = new ConversationService(
      llmProvider,
      sessionStore,
      toolRegistry,
    );

    const reply = await service.handleTurn('session-1', 'hi', {
      accessToken: 'tok',
    });

    expect(reply).toBe('Hello there');
    expect(execute).not.toHaveBeenCalled();

    const history = await sessionStore.getHistory('session-1');
    expect(history).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello there' },
    ]);
  });

  it('executes tool calls and feeds results back into the next LLM turn', async () => {
    const { llmProvider, complete } = makeLlmProvider();
    complete
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'call-1', name: 'get_thing', arguments: { id: '42' } },
          ],
        },
        stopReason: 'tool_calls',
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Done' },
        stopReason: 'stop',
      });
    const { toolRegistry, execute } = makeToolRegistry('{"result":"ok"}');
    const service = new ConversationService(
      llmProvider,
      sessionStore,
      toolRegistry,
    );

    const reply = await service.handleTurn('session-1', 'do the thing', {
      accessToken: 'tok',
    });

    expect(reply).toBe('Done');
    expect(execute).toHaveBeenCalledWith(
      'get_thing',
      { id: '42' },
      { accessToken: 'tok' },
    );
    expect(complete).toHaveBeenCalledTimes(2);
  });


  it('records bounded, redacted invocation arguments and preserves tool output', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const { llmProvider, complete } = makeLlmProvider();
      complete
        .mockResolvedValueOnce({
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'call-1', name: 'get_thing', arguments: { id: '42', accessToken: 'secret', prompt: 'private request' } },
            ],
          },
          stopReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          message: { role: 'assistant', content: 'Finished' },
          stopReason: 'stop',
        });
      const { toolRegistry, execute } = makeToolRegistry('tool output');
      const service = new ConversationService(llmProvider, sessionStore, toolRegistry);

      expect(await service.handleTurn('s1', 'test', { accessToken: 'secret' })).toBe('Finished');
      expect(execute).toHaveBeenCalledWith('get_thing', {
        id: '42', accessToken: 'secret', prompt: 'private request',
      }, { accessToken: 'secret' });

      const entry = JSON.parse(String(log.mock.calls[log.mock.calls.length - 1]?.[0])) as {
        event: string; tool: string; args: Record<string, string>;
        durationMs: number; success: boolean;
      };
      expect(entry).toMatchObject({
        event: 'tool_invocation',
        tool: 'get_thing',
        args: { id: '42', accessToken: '[REDACTED]', prompt: '[REDACTED]' },
        success: true,
      });
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      log.mockRestore();
    }
  });

  it('reports registry error results as failed invocations without changing the result', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const { llmProvider, complete } = makeLlmProvider();
      complete
        .mockResolvedValueOnce({
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call-1', name: 'bad_tool', arguments: {} }],
          },
          stopReason: 'tool_calls',
        })
        .mockResolvedValueOnce({
          message: { role: 'assistant', content: 'Handled' },
          stopReason: 'stop',
        });
      const { toolRegistry, execute } = makeToolRegistry('Error executing tool "bad_tool": unavailable');
      const service = new ConversationService(llmProvider, sessionStore, toolRegistry);

      expect(await service.handleTurn('s2', 'test', { accessToken: 'secret' })).toBe('Handled');
      expect(execute).toHaveBeenCalledTimes(1);
      const entry = JSON.parse(String(log.mock.calls[log.mock.calls.length - 1]?.[0])) as {
        event: string; tool: string; success: boolean;
      };
      expect(entry).toMatchObject({
        event: 'tool_invocation', tool: 'bad_tool', success: false,
      });
    } finally {
      log.mockRestore();
    }
  });

  it('gives up after the max number of tool iterations', async () => {
    const { llmProvider, complete } = makeLlmProvider();
    complete.mockResolvedValue({
      message: {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'loop_tool', arguments: {} }],
      },
      stopReason: 'tool_calls',
    });
    const { toolRegistry } = makeToolRegistry();
    const service = new ConversationService(
      llmProvider,
      sessionStore,
      toolRegistry,
    );

    const reply = await service.handleTurn('session-1', 'loop forever', {
      accessToken: 'tok',
    });

    expect(reply).toMatch(/wasn't able to finish/i);
    expect(complete).toHaveBeenCalledTimes(8);
  });

  it('only sends the system prompt on the first turn of a session', async () => {
    const { llmProvider, complete } = makeLlmProvider();
    complete.mockResolvedValue({
      message: { role: 'assistant', content: 'ok' },
      stopReason: 'stop',
    });
    const { toolRegistry } = makeToolRegistry();
    const service = new ConversationService(
      llmProvider,
      sessionStore,
      toolRegistry,
    );

    await service.handleTurn('session-1', 'first', { accessToken: 'tok' });
    await service.handleTurn('session-1', 'second', { accessToken: 'tok' });

    const firstCallMessages = complete.mock.calls[0][0].messages;
    const secondCallMessages = complete.mock.calls[1][0].messages;
    expect(firstCallMessages[0].role).toBe('system');
    expect(secondCallMessages.some((m) => m.role === 'system')).toBe(false);
  });

  it('clears session history on resetSession', async () => {
    await sessionStore.appendMessages('session-1', [
      { role: 'user', content: 'hi' },
    ]);
    const { llmProvider } = makeLlmProvider();
    const { toolRegistry } = makeToolRegistry();
    const service = new ConversationService(
      llmProvider,
      sessionStore,
      toolRegistry,
    );

    await service.resetSession('session-1');

    expect(await sessionStore.getHistory('session-1')).toEqual([]);
  });

  it('bounds the outbound history for a long session instead of sending it all', async () => {
    const filler = 'x'.repeat(50);
    for (let i = 0; i < 50; i++) {
      await sessionStore.appendMessages('session-1', [
        { role: 'user', content: `question ${i} ${filler}` },
        { role: 'assistant', content: `answer ${i} ${filler}` },
      ]);
    }
    const fullHistory = await sessionStore.getHistory('session-1');
    expect(fullHistory.length).toBe(100); // sanity check on the seeded fixture

    const { llmProvider, complete } = makeLlmProvider();
    complete.mockResolvedValue({
      message: { role: 'assistant', content: 'ok' },
      stopReason: 'stop',
    });
    const { toolRegistry } = makeToolRegistry();
    const smallBudget = 200; // far below the ~1600-token full seeded history
    const service = new ConversationService(
      llmProvider,
      sessionStore,
      toolRegistry,
      smallBudget,
    );

    await service.handleTurn('session-1', 'final question', {
      accessToken: 'tok',
    });

    const outboundMessages = complete.mock.calls[0][0].messages;

    expect(outboundMessages.length).toBeLessThan(fullHistory.length);
    expect(
      outboundMessages.some((m) => m.content.includes('final question')),
    ).toBe(true);
    expect(
      outboundMessages.some((m) => m.content.includes('question 0 ')),
    ).toBe(false);

    const nonSystemMessages = outboundMessages.filter(
      (m) => m.role !== 'system',
    );
    expect(nonSystemMessages[0]?.role).toBe('user');
  });
});
