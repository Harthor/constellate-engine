export function timer(): () => number {
  const start = Date.now();
  return () => Date.now() - start;
}
