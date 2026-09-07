import { spawnSync } from 'node:child_process';

export function shouldSkipRemoteValidation(remoteUrl: string | null | undefined, config?: { enabled?: boolean; paused?: boolean }): boolean {
  if (!remoteUrl) return true;
  if (config && config.enabled === false) return true;
  if (config && config.paused) return true;

  const normalized = remoteUrl.trim();
  return normalized.startsWith('http://') || normalized.startsWith('https://') || normalized.startsWith('git://');
}

function normalizeGitArgs(args: string[] | string): string[] {
  if (Array.isArray(args)) return args;

  return args.trim().split(/\s+/).filter(Boolean);
}

export function execGit(args: string[] | string, options: { stdio?: 'pipe' | 'inherit' | 'ignore' | Array<'pipe' | 'inherit' | 'ignore'> } = {}): string {
  const normalizedArgs = normalizeGitArgs(args);
  const result = spawnSync('git', normalizedArgs, {
    encoding: 'utf-8',
    stdio: options.stdio || 'pipe',
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  return (result.stdout || '') as string;
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
  execGit(['add', ...items]);
}

export function gitRestoreStaged(...paths: Array<string | string[] | undefined | null>): void {
  const items = paths.filter(Boolean).flatMap((value) => {
    if (Array.isArray(value)) return value.filter(Boolean);
    return [value as string];
  });

  if (!items.length) return;

  try {
    execGit(['restore', '--staged', ...items]);
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
    execGit(['reset', ...items]);
  } catch {
    // Ignore if no files matched.
  }
}
