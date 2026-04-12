export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status;
      if ((status === 429 || status === 529) && attempt < maxRetries) {
        const delay = Math.min(2000 * Math.pow(2, attempt), 30000);
        console.log(
          `[retry] Rate limited, waiting ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
  throw new Error('Max retries exceeded');
}
