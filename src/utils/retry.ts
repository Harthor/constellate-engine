const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 529]);

const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
]);

export function isRetryableError(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  if (typeof status === 'number') return RETRYABLE_STATUS.has(status);

  // No HTTP status: transient transport failures surface as Node error
  // codes (sometimes nested under cause) or as the SDK's connection error.
  const code =
    (e as { code?: string })?.code ??
    (e as { cause?: { code?: string } })?.cause?.code;
  if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) return true;

  return (e as { name?: string })?.name === 'APIConnectionError';
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 2000,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: unknown) {
      if (isRetryableError(e) && attempt < maxRetries) {
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt), 30000);
        const label =
          (e as { status?: number })?.status ??
          (e as { code?: string })?.code ??
          (e as { name?: string })?.name ??
          'unknown';
        console.log(
          `[retry] Transient error (${label}), waiting ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
  throw new Error('Max retries exceeded');
}
