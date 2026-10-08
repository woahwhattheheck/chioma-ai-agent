import { OpenAiLlmProvider } from './openai.provider';
import type { AppConfig } from '../../../config/env.validation';

const mockCreate = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: (...args: unknown[]) => mockCreate(...args) } },
  })),
}));

describe('OpenAiLlmProvider', () => {
  const config = { llmModel: 'gpt-4o-mini', openaiApiKey: 'test-key' } as AppConfig;
  beforeEach(() => mockCreate.mockReset());

  it('serializes every supported message role and tool call', async () => {
    mockCreate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: 'Done' } }] });
    await new OpenAiLlmProvider(config).complete({
      messages: [
        { role: 'system', content: 'Rules' },
        { role: 'user', content: 'Find rental' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'lookup', arguments: { id: 7 } }] },
        { role: 'tool', toolCallId: 'c1', name: 'lookup', content: 'result' },
      ],
      tools: [{ name: 'lookup', description: 'Lookup', parameters: { type: 'object' } }],
    });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o-mini',
      max_tokens: 4096,
      messages: [
        { role: 'system', content: 'Rules' },
        { role: 'user', content: 'Find rental' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{"id":7}' },
          }],
        },
        { role: 'tool', tool_call_id: 'c1', content: 'result' },
      ],
      tools: [{ type: 'function', function: { name: 'lookup', description: 'Lookup', parameters: { type: 'object' } } }],
    }));
  });

  it('parses tool-call arguments and maps finish_reason tool_calls', async () => {
    mockCreate.mockResolvedValue({ choices: [{
      finish_reason: 'tool_calls',
      message: { content: null, tool_calls: [{ id: 'c2', type: 'function', function: { name: 'find', arguments: '{"id":"p1"}' } }] },
    }] });
    const result = await new OpenAiLlmProvider(config).complete({ messages: [] });
    expect(result).toEqual({
      message: { role: 'assistant', content: '', toolCalls: [{ id: 'c2', name: 'find', arguments: { id: 'p1' } }] },
      stopReason: 'tool_calls',
    });
  });

  it.each([
    ['length', 'length'],
    ['stop', 'stop'],
    ['content_filter', 'stop'],
  ])('maps %s finish reason to %s', async (finishReason, expected) => {
    mockCreate.mockResolvedValue({ choices: [{ finish_reason: finishReason, message: { content: 'Text' } }] });
    const result = await new OpenAiLlmProvider(config).complete({ messages: [] });
    expect(result.message).toEqual({ role: 'assistant', content: 'Text', toolCalls: undefined });
    expect(result.stopReason).toBe(expected);
  });
});
