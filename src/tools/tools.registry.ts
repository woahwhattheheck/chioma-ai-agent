import { Inject, Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { LlmToolDefinition } from '../agent/llm/llm.types';
import { StructuredLogger } from '../observability/structured-logger';

export const AGENT_TOOLS = Symbol('AGENT_TOOLS');

@Injectable()
export class ToolRegistry {
  private readonly toolsByName = new Map<string, AgentTool>();
  private readonly logger = new StructuredLogger();

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
    const started = Date.now();
    const safeName = /^[a-zA-Z_][a-zA-Z0-9_-]{0,79}$/.test(name) ? name : 'unknown';
    const tool = this.toolsByName.get(name);
    if (!tool) {
      this.logger.record('warn', 'tool.execution', {
        tool: safeName, outcome: 'unknown', duration_ms: Date.now() - started,
      });
      return 'Error: unknown tool "' + name + '"';
    }
    try {
      const output = await tool.execute(args, context);
      this.logger.record('info', 'tool.execution', {
        tool: safeName, outcome: 'ok', duration_ms: Date.now() - started,
      });
      return output;
    } catch (error) {
      this.logger.record('error', 'tool.execution', {
        tool: safeName, outcome: 'error', duration_ms: Date.now() - started,
        error_type: error instanceof Error ? error.name : 'UnknownError',
      });
      return 'Error executing tool "' + name + '": ' + (error as Error).message;
    }
  }
}
