import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { LLM_PROVIDER, LlmProvider } from '../llm/llm-provider.interface';
import { LlmMessage } from '../llm/llm.types';
import { SESSION_STORE, SessionStore } from '../memory/session-store.interface';
import { ToolRegistry } from '../../tools/tools.registry';
import { ToolContext } from '../../tools/tool.interface';
import { SYSTEM_PROMPT } from './system-prompt';
import { applyHistoryWindow } from './history-window';

/** Falls back to AppConfig's default when no provider registers this token. */
const DEFAULT_HISTORY_TOKEN_BUDGET = 24000;

/** Falls back to AppConfig's default when no provider registers this token. */
const DEFAULT_MAX_TOOL_ITERATIONS = 8;

export const HISTORY_TOKEN_BUDGET = Symbol('HISTORY_TOKEN_BUDGET');
export const MAX_TOOL_ITERATIONS = Symbol('MAX_TOOL_ITERATIONS');

/**
 * Tool inputs can include customer text, passwords, and auth parameters. Only
 * bounded, redacted arguments belong in operational logs; never log ToolContext.
 */
const SENSITIVE_TOOL_ARGUMENT = /token|secret|password|credential|authorization|cookie|api[_-]?key|private[_-]?key|session[_-]?key|prompt|query|message|content|text/i;

function safeToolLogArguments(args: Record<string, unknown>): unknown {
  try {
    const serialized = JSON.stringify(args, (key, value: unknown) => {
      if (SENSITIVE_TOOL_ARGUMENT.test(key)) return '[REDACTED]';
      if (typeof value === 'string' && value.length > 256) {
        return `[LONG_STRING:${value.length}_CHARS]`;
      }
      return value;
    });
    if (!serialized || serialized.length > 2048) return '[ARGS_TOO_LARGE]';
    return JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    return '[UNSERIALIZABLE_ARGS]';
  }
}

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);
  constructor(
    @Inject(LLM_PROVIDER) private readonly llmProvider: LlmProvider,
    @Inject(SESSION_STORE) private readonly sessionStore: SessionStore,
    private readonly toolRegistry: ToolRegistry,
    @Optional()
    @Inject(HISTORY_TOKEN_BUDGET)
    private readonly historyTokenBudget: number = DEFAULT_HISTORY_TOKEN_BUDGET,
    @Optional()
    @Inject(MAX_TOOL_ITERATIONS)
    private readonly maxToolIterations: number = DEFAULT_MAX_TOOL_ITERATIONS,
  ) {}

  async handleTurn(
    sessionId: string,
    userInput: string,
    toolContext: ToolContext,
  ): Promise<string> {
    const history = await this.sessionStore.getHistory(sessionId);
    const windowedHistory = applyHistoryWindow(
      history,
      this.historyTokenBudget,
    );
    const messages: LlmMessage[] = [
      ...windowedHistory,
      { role: 'user', content: userInput },
    ];
    const newMessages: LlmMessage[] = [{ role: 'user', content: userInput }];

    const systemMessages: LlmMessage[] = history.length
      ? []
      : [{ role: 'system', content: SYSTEM_PROMPT }];

    const tools = this.toolRegistry.getDefinitions();

    for (let iteration = 0; iteration < this.maxToolIterations; iteration++) {
      const result = await this.llmProvider.complete({
        messages: [...systemMessages, ...messages],
        tools,
      });

      messages.push(result.message);
      newMessages.push(result.message);

      if (
        result.stopReason !== 'tool_calls' ||
        !result.message.toolCalls?.length
      ) {
        await this.sessionStore.appendMessages(sessionId, newMessages);
        return result.message.content;
      }

      for (const toolCall of result.message.toolCalls) {
        const startedAt = Date.now();
        const logArguments = safeToolLogArguments(toolCall.arguments);
        let output: string;
        try {
          output = await this.toolRegistry.execute(
            toolCall.name,
            toolCall.arguments,
            toolContext,
          );
        } catch (error) {
          this.logger.error(JSON.stringify({
            event: 'tool_invocation',
            tool: toolCall.name,
            args: logArguments,
            durationMs: Date.now() - startedAt,
            success: false,
            error: 'tool_registry_threw',
          }));
          throw error;
        }
        // ToolRegistry converts known tool errors to strings, not exceptions.
        const success = !(
          output.startsWith(`Error: unknown tool "${toolCall.name}"`) ||
          output.startsWith(`Error executing tool "${toolCall.name}":`)
        );
        this.logger.log(JSON.stringify({
          event: 'tool_invocation',
          tool: toolCall.name,
          args: logArguments,
          durationMs: Date.now() - startedAt,
          success,
        }));
        const toolMessage: LlmMessage = {
          role: 'tool',
          content: output,
          toolCallId: toolCall.id,
          name: toolCall.name,
        };
        messages.push(toolMessage);
        newMessages.push(toolMessage);
      }
    }

    await this.sessionStore.appendMessages(sessionId, newMessages);
    return "I wasn't able to finish that request after several tool calls. Could you rephrase or narrow it down?";
  }

  async resetSession(sessionId: string): Promise<void> {
    await this.sessionStore.clear(sessionId);
  }

  static newSessionId(): string {
    return uuid();
  }
}
