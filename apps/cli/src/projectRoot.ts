export function resolveProjectRoot(input: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): string {
  const env = input.env ?? process.env;
  const cwd = input.cwd ?? process.cwd();
  const initialCwd = env.INIT_CWD?.trim();

  return initialCwd ? initialCwd : cwd;
}
