#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface IncomingPair {
  envFilePath: string;
  incomingFilePath: string;
}

export function inferIncomingFilePath(envFilePath: string): string {
  return `${envFilePath}.incoming`;
}

export function inferEnvFilePathFromIncoming(incomingFilePath: string): string | null {
  if (!incomingFilePath.endsWith('.incoming')) {
    return null;
  }

  return incomingFilePath.slice(0, -'.incoming'.length);
}

export function compareIncomingPair(envFilePath: string, incomingFilePath: string): boolean {
  if (!fs.existsSync(envFilePath)) {
    console.error(`✕ Cannot compare: local env file does not exist: ${envFilePath}`);
    return false;
  }

  if (!fs.existsSync(incomingFilePath)) {
    console.error(`✕ Cannot compare: incoming file does not exist: ${incomingFilePath}`);
    return false;
  }

  const gitDiff = spawnSync(
    'git',
    ['--no-pager', 'diff', '--no-index', '--color=always', '--', envFilePath, incomingFilePath],
    { encoding: 'utf-8' },
  );

  const output = `${gitDiff.stdout || ''}${gitDiff.stderr || ''}`;
  if (output.trim().length > 0) {
    process.stderr.write(output.endsWith('\n') ? output : `${output}\n`);
  }

  if (gitDiff.status === 0) {
    console.error(`✓ No differences between ${envFilePath} and ${incomingFilePath}.`);
    return true;
  }

  if (gitDiff.status === 1) {
    return true;
  }

  const fallback = spawnSync('diff', ['-u', '--color=always', envFilePath, incomingFilePath], {
    encoding: 'utf-8',
  });

  const fallbackOutput = `${fallback.stdout || ''}${fallback.stderr || ''}`;
  if (fallbackOutput.trim().length > 0) {
    process.stderr.write(fallbackOutput.endsWith('\n') ? fallbackOutput : `${fallbackOutput}\n`);
  }

  if (fallback.status === 0 || fallback.status === 1) {
    return true;
  }

  console.error('✕ Failed to generate a diff for incoming env changes.');
  return false;
}

export function listIncomingPairs(projectRoot = process.cwd()): IncomingPair[] {
  const entries = fs.readdirSync(projectRoot, { withFileTypes: true });

  return entries
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.startsWith('.env'))
    .filter((entry) => entry.name.endsWith('.incoming'))
    .map((entry) => {
      const incomingFilePath = path.join(projectRoot, entry.name);
      const envFilePath = inferEnvFilePathFromIncoming(incomingFilePath) || incomingFilePath;
      return { envFilePath, incomingFilePath };
    })
    .sort((left, right) => left.incomingFilePath.localeCompare(right.incomingFilePath));
}

export function runCompareIncoming(argv = process.argv.slice(2)) {
  const candidatePath = argv[0];

  if (candidatePath) {
    const resolvedPath = path.resolve(candidatePath);
    const incomingFilePath = resolvedPath.endsWith('.incoming')
      ? resolvedPath
      : inferIncomingFilePath(resolvedPath);
    const envFilePath = resolvedPath.endsWith('.incoming')
      ? (inferEnvFilePathFromIncoming(resolvedPath) ?? resolvedPath)
      : resolvedPath;

    const success = compareIncomingPair(envFilePath, incomingFilePath);
    if (!success) {
      process.exit(1);
    }
    return;
  }

  const pairs = listIncomingPairs(process.cwd());
  if (pairs.length === 0) {
    console.error('No .incoming files found to compare.');
    return;
  }

  let hadFailure = false;
  for (const pair of pairs) {
    console.error(`\nComparing ${pair.envFilePath} with ${pair.incomingFilePath}:`);
    const success = compareIncomingPair(pair.envFilePath, pair.incomingFilePath);
    if (!success) {
      hadFailure = true;
    }
  }

  if (hadFailure) {
    process.exit(1);
  }
}

if (require.main === module) {
  runCompareIncoming();
}
