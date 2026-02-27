type RetryConfig = {
  timeoutMs: number;
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
};

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  timeoutMs: Number(process.env.AGENTFORGE_LLM_TIMEOUT_MS ?? 20_000),
  maxAttempts: Number(process.env.AGENTFORGE_LLM_MAX_ATTEMPTS ?? 3),
  initialBackoffMs: Number(process.env.AGENTFORGE_LLM_RETRY_BASE_MS ?? 300),
  maxBackoffMs: Number(process.env.AGENTFORGE_LLM_RETRY_MAX_MS ?? 2_500),
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function backoffDelayMs(attempt: number, cfg: RetryConfig): number {
  const exp = cfg.initialBackoffMs * 2 ** Math.max(0, attempt - 1);
  return clampNumber(exp, cfg.initialBackoffMs, cfg.maxBackoffMs);
}

function getConfig(): RetryConfig {
  return {
    timeoutMs: clampNumber(DEFAULT_RETRY_CONFIG.timeoutMs, 1_000, 180_000),
    maxAttempts: Math.trunc(clampNumber(DEFAULT_RETRY_CONFIG.maxAttempts, 1, 8)),
    initialBackoffMs: clampNumber(DEFAULT_RETRY_CONFIG.initialBackoffMs, 25, 10_000),
    maxBackoffMs: clampNumber(DEFAULT_RETRY_CONFIG.maxBackoffMs, 100, 30_000),
  };
}

export async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const cfg = getConfig();
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        return response;
      }

      const bodyText = await response.text();
      if (!shouldRetryStatus(response.status) || attempt >= cfg.maxAttempts) {
        throw new Error(
          `request_failed status=${response.status} attempt=${attempt}/${cfg.maxAttempts} body=${bodyText}`
        );
      }
      lastError = new Error(
        `retryable_status status=${response.status} attempt=${attempt}/${cfg.maxAttempts} body=${bodyText}`
      );
    } catch (error) {
      clearTimeout(timeout);
      const message = error instanceof Error ? error.message : String(error);
      const isAbort = message.toLowerCase().includes('abort');
      const maybeNetwork =
        message.toLowerCase().includes('fetch') ||
        message.toLowerCase().includes('network') ||
        message.toLowerCase().includes('timeout');
      const retryable = isAbort || maybeNetwork;
      if (!retryable || attempt >= cfg.maxAttempts) {
        throw error;
      }
      lastError = error;
    }

    await sleep(backoffDelayMs(attempt, cfg));
  }

  throw new Error(
    `request_exhausted attempts=${getConfig().maxAttempts} lastError=${String(lastError)}`
  );
}
