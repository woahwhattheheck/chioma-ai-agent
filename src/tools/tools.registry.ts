import { Inject, Injectable, Logger } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { LlmToolDefinition } from '../agent/llm/llm.types';

export const AGENT_TOOLS = Symbol('AGENT_TOOLS');

@Injectable()
export class ToolRegistry {
  private readonly toolsByName = new Map<string, AgentTool>();
  private readonly logger = new Logger(ToolRegistry.name);

  constructor(@Inject(AGENT_TOOLS) tools: AgentTool[]) {
    for (const tool of tools) {
      this.toolsByName.set(tool.definition.name, tool);
    }
  }

  getDefinitions(): LlmToolDefinition[] {
    return Array.from(this.toolsByName.values(), (tool) => tool.definition);
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<string> {
    const tool = this.toolsByName.get(name);
    if (!tool) {
      return `Error: unknown tool "${name}"`;
    }
    try {
      return await tool.execute(args, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Structured operational evidence without exposing bearer tokens or
      // credentials embedded in nested LLM-generated arguments.
      this.logger.error(
        {
          event: 'agent_tool_execution_error',
          toolName: name,
          args: this.redactArgs(args),
          sessionId: context.sessionId ?? null,
          error: message,
        },
        error instanceof Error ? error.stack : undefined,
      );
      return `Error executing tool "${name}": ${message}`;
    }
  }

  private redactArgs(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.redactArgs(entry));
    }
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
          key,
          /token|secret|password|authorization|cookie|api[_-]?key/i.test(key)
            ? '[REDACTED]'
            : this.redactArgs(entry),
        ]),
      );
    }
    return value;
  }
}
