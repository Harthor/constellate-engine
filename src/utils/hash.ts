import { createHash } from 'crypto';

export function hashIds(ids: number[]): string {
  const sorted = [...ids].sort((a, b) => a - b);
  return createHash('sha256').update(sorted.join(',')).digest('hex');
}
