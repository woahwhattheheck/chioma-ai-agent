export type LlmProvider = 'openai' | 'anthropic';
export type SessionStore = 'memory' | 'redis';

export interface RootConfig {
  app: AppConfig;
}

export interface AppConfig {
  nodeEnv: string;
  port: number;
  allowedOrigins: string[];
  llmProvider: LlmProvider;
  llmModel: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  chiomaApiUrl: string;
  chiomaApiToken?: string;
  stellarHorizonUrl: string;
  sessionStore: SessionStore;
  redisUrl: string;
  sessionTtlSeconds: number;
  /**
   * Max tokens of *prior session history* sent to the LLM per turn (the
   * current user message, system prompt, and tool definitions are on top of
   * this). See ConversationService.handleTurn + applyHistoryWindow.
   */
  historyTokenBudget: number;
  /**
   * Max LLM/tool-call loop iterations allowed for a single conversation turn.
   */
  maxToolIterations: number;
}

/**
 * CORS origins must be exact http(s) origins, never paths, credentials, or "*".
 * A narrow local-development default is used when ALLOWED_ORIGINS is omitted.
 */
export function parseAllowedOrigins(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Invalid ALLOWED_ORIGINS');
  }
  const origins = value.split(',').map((origin) => origin.trim());
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error('Invalid ALLOWED_ORIGINS');
    }
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.origin !== origin
    ) {
      throw new Error('Invalid ALLOWED_ORIGINS');
    }
  }
  return [...new Set(origins)];
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Accepted `LLM_MODEL` values per provider. A typo'd or deprecated model is
 * rejected at boot (see validateEnvironment) rather than surfacing as a
 * confusing runtime API error on the first chat request. Extend these lists as
 * new models are adopted.
 */
const LLM_MODEL_ALLOWLIST: Record<LlmProvider, readonly string[]> = {
  anthropic: [
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-sonnet-5',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
  ],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4-turbo'],
};

/**
 * Wired into ConfigModule.forRoot({ validate }) so misconfiguration fails at
 * boot rather than surfacing as a confusing runtime error mid-conversation.
 */
export function validateEnvironment(
  env: Record<string, unknown>,
): Record<string, unknown> {
  const errors: string[] = [];

  const llmProvider = (env.LLM_PROVIDER as string) || 'anthropic';
  if (llmProvider !== 'openai' && llmProvider !== 'anthropic') {
    errors.push('LLM_PROVIDER must be "openai" or "anthropic"');
  }
  if (llmProvider === 'openai' && !isNonEmpty(env.OPENAI_API_KEY)) {
    errors.push('OPENAI_API_KEY is required when LLM_PROVIDER=openai');
  }
  if (llmProvider === 'anthropic' && !isNonEmpty(env.ANTHROPIC_API_KEY)) {
    errors.push('ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic');
  }

  // Only validate the model against a known provider's allowlist. When
  // LLM_MODEL is unset, loadConfig() falls back to a valid default, so an
  // absent value is intentionally allowed here.
  if (llmProvider === 'openai' || llmProvider === 'anthropic') {
    const allowed = LLM_MODEL_ALLOWLIST[llmProvider];
    if (isNonEmpty(env.LLM_MODEL) && !allowed.includes(env.LLM_MODEL)) {
      errors.push(
        `LLM_MODEL "${env.LLM_MODEL}" is not a recognized model for ` +
          `LLM_PROVIDER=${llmProvider}. Allowed models: ${allowed.join(', ')}`,
      );
    }
  }

  if (!isNonEmpty(env.CHIOMA_API_URL)) {
    errors.push('CHIOMA_API_URL is required');
  }

  if (env.NODE_ENV === 'production' && !isNonEmpty(env.ALLOWED_ORIGINS)) {
    errors.push('ALLOWED_ORIGINS must be configured in production');
  }
  try {
    parseAllowedOrigins(env.ALLOWED_ORIGINS ?? 'http://localhost:3000');
  } catch {
    errors.push('ALLOWED_ORIGINS must contain canonical http(s) origins; wildcards and paths are not allowed');
  }

  const sessionStore = (env.SESSION_STORE as string) || 'memory';
  if (sessionStore !== 'memory' && sessionStore !== 'redis') {
    errors.push('SESSION_STORE must be "memory" or "redis"');
  }
  if (sessionStore === 'redis' && !isNonEmpty(env.REDIS_URL)) {
    errors.push('REDIS_URL is required when SESSION_STORE=redis');
  }

  if (isNonEmpty(env.HISTORY_TOKEN_BUDGET)) {
    const parsedBudget = Number(env.HISTORY_TOKEN_BUDGET);
    if (!Number.isFinite(parsedBudget) || parsedBudget <= 0) {
      errors.push('HISTORY_TOKEN_BUDGET must be a positive number');
    }
  }

  if (isNonEmpty(env.MAX_TOOL_ITERATIONS)) {
    const parsedIterations = Number(env.MAX_TOOL_ITERATIONS);
    if (
      !Number.isInteger(parsedIterations) ||
      parsedIterations <= 0
    ) {
      errors.push('MAX_TOOL_ITERATIONS must be a positive integer');
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n  - ${errors.join('\n  - ')}`,
    );
  }

  return env;
}

export function loadConfig(): AppConfig {
  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3100', 10),
    allowedOrigins: parseAllowedOrigins(
      process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000',
    ),
    llmProvider: (process.env.LLM_PROVIDER as LlmProvider) ?? 'anthropic',
    llmModel: process.env.LLM_MODEL ?? 'claude-opus-4-8',
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    chiomaApiUrl: process.env.CHIOMA_API_URL ?? 'http://localhost:3000',
    chiomaApiToken: process.env.CHIOMA_API_TOKEN,
    stellarHorizonUrl:
      process.env.STELLAR_HORIZON_URL ?? 'https://horizon-testnet.stellar.org',
    sessionStore: (process.env.SESSION_STORE as SessionStore) ?? 'memory',
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    sessionTtlSeconds: parseInt(process.env.SESSION_TTL_SECONDS ?? '3600', 10),
    historyTokenBudget: parseInt(
      process.env.HISTORY_TOKEN_BUDGET ?? '24000',
      10,
    ),
    maxToolIterations: parseInt(process.env.MAX_TOOL_ITERATIONS ?? '8', 10),
  };
}
