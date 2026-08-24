import { execSync } from 'node:child_process';

export function execGit(args: string[] | string, options: { stdio?: 'pipe' | 'inherit' | 'ignore' | Array<'pipe' | 'inherit' | 'ignore'> } = {}): string {
  const command = Array.isArray(args) ? args.join(' ') : args;
  return execSync(`git ${command}`, {
    encoding: 'utf-8',
    stdio: options.stdio || 'pipe',
    ...options
  }) as string;
}

export function getGitRoot(): string {
  return execGit('rev-parse --show-toplevel').trim();
}

export function getGitDir(): string {
  return execGit('rev-parse --git-dir').trim();
}

export function getGitHooksDir(): string {
  return execGit('rev-parse --git-path hooks').trim();
}

export function getRemoteGitUrl(): string | null {
  try {
    const remoteUrl = execGit('config --get remote.origin.url || echo ""').trim();
    return remoteUrl || null;
  } catch {
    return null;
  }
}

export function gitAdd(...paths: Array<string | string[] | undefined | null>): void {
  const items = paths.filter(Boolean).flatMap((value) => {
    if (Array.isArray(value)) return value.filter(Boolean);
    return [value as string];
  });

  if (!items.length) return;
  execGit(['add', ...items.map((item) => `"${item}"`)]);
}

export function gitRestoreStaged(...paths: Array<string | string[] | undefined | null>): void {
  const items = paths.filter(Boolean).flatMap((value) => {
    if (Array.isArray(value)) return value.filter(Boolean);
    return [value as string];
  });

  if (!items.length) return;

  try {
    execGit(['restore', '--staged', ...items.map((item) => `"${item}"`)]);
  } catch {
    // Ignore if file was never staged.
  }
}

export function gitResetPaths(...paths: Array<string | string[] | undefined | null>): void {
  const items = paths.filter(Boolean).flatMap((value) => {
    if (Array.isArray(value)) return value.filter(Boolean);
    return [value as string];
  });

  if (!items.length) return;

  try {
    execGit(['reset', ...items.map((item) => `"${item}"`)]);
  } catch {
    // Ignore if no files matched.
  }
}
