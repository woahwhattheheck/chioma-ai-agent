import { AnthropicLlmProvider } from './anthropic.provider';
import type { AppConfig } from '../../../config/env.validation';

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: (...args: unknown[]) => mockCreate(...args) },
  })),
}));

const config = {
  llmModel: 'claude-sonnet-4-6',
  anthropicApiKey: 'test-key',
} as AppConfig;

describe('AnthropicLlmProvider message and result translation', () => {
  beforeEach(() => mockCreate.mockReset());

  it('extracts system messages, encodes assistant tool_use and groups tool_result blocks', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Done' }], stop_reason: 'end_turn' });
    const provider = new AnthropicLlmProvider(config);

    await provider.complete({
      maxTokens: 123,
      messages: [
        { role: 'system', content: 'Policy A' },
        { role: 'system', content: 'Policy B' },
        { role: 'user', content: 'Find a home' },
        {
          role: 'assistant',
          content: 'Looking',
          toolCalls: [{ id: 'call-1', name: 'lookup', arguments: { id: 'p1' } }],
        },
        { role: 'tool', content: '{"found":true}', toolCallId: 'call-1' },
        { role: 'tool', content: '{"ok":true}', toolCallId: 'call-2' },
      ],
      tools: [{ name: 'lookup', description: 'Find', parameters: { type: 'object' } }],
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith({
      model: 'claude-sonnet-4-6',
      max_tokens: 123,
      system: 'Policy A\n\nPolicy B',
      messages: [
        { role: 'user', content: 'Find a home' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Looking' },
            { type: 'tool_use', id: 'call-1', name: 'lookup', input: { id: 'p1' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call-1', content: '{"found":true}' },
            { type: 'tool_result', tool_use_id: 'call-2', content: '{"ok":true}' },
          ],
        },
      ],
      tools: [{ name: 'lookup', description: 'Find', input_schema: { type: 'object' } }],
    });
  });

  it('parses interleaved text and tool_use into tool calls with a tool_calls stop reason', async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: 'text', text: 'Starting ' },
        { type: 'tool_use', id: 'call-3', name: 'lookup', input: { id: 42 } },
        { type: 'text', text: 'search' },
      ],
      stop_reason: 'tool_use',
    });
    const result = await new AnthropicLlmProvider(config).complete({ messages: [] });
    expect(result).toEqual({
      message: {
        role: 'assistant',
        content: 'Starting search',
        toolCalls: [{ id: 'call-3', name: 'lookup', arguments: { id: 42 } }],
      },
      stopReason: 'tool_calls',
    });
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ max_tokens: 4096, system: undefined });
  });

  it.each([
    ['max_tokens', 'length'],
    ['end_turn', 'stop'],
    [null, 'stop'],
  ])('maps SDK stop_reason %s to %s', async (stopReason, expected) => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Hello' }], stop_reason: stopReason });
    const result = await new AnthropicLlmProvider(config).complete({ messages: [] });
    expect(result.stopReason).toBe(expected);
    expect(result.message).toEqual({ role: 'assistant', content: 'Hello', toolCalls: undefined });
  });
});
