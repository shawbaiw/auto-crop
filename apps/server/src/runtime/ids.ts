export function createDefaultId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
