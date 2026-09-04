export function createId(prefix: string): string {
  const normalizedPrefix = prefix.trim().toLowerCase();

  if (!/^[a-z][a-z0-9_-]*$/.test(normalizedPrefix)) {
    throw new Error(`Invalid id prefix: ${prefix}`);
  }

  return `${normalizedPrefix}_${crypto.randomUUID()}`;
}
