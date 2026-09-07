#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { getGitRoot } from '../utils/git';
import { ensureManualMode, stageEnvSecrets } from '../utils/envWorkflow';

function parseCommitMessage(argv: string[]): string {
  const shortIndex = argv.indexOf('-m');
  const longIndex = argv.indexOf('--message');
  const index = shortIndex >= 0 ? shortIndex : longIndex;

  if (index === -1) {
    return 'security: update encrypted env files';
  }

  const message = argv[index + 1];
  if (!message || message.startsWith('-')) {
    throw new Error('Missing commit message after -m/--message.');
  }

  return message;
}

function runPushEnv() {
  try {
    const rootDir = getGitRoot();
    process.chdir(rootDir);
    ensureManualMode(rootDir);

    const commitMessage = parseCommitMessage(process.argv.slice(2));
    const { envFiles, encryptedCount } = stageEnvSecrets(rootDir);

    if (envFiles.length === 0) {
      console.log('No .env files were found. Nothing to encrypt or commit.');
      process.exit(0);
    }

    const hasStagedChanges = spawnSync('git', ['diff', '--cached', '--quiet']);
    if (hasStagedChanges.status === 0) {
      console.log('No staged changes were produced. Skipping commit.');
      process.exit(0);
    }

    const commitResult = spawnSync('git', ['commit', '-m', commitMessage], { stdio: 'inherit' });
    if (commitResult.status !== 0) {
      throw new Error('git commit failed');
    }

    console.log(`✓ Committed encrypted updates for ${encryptedCount} .env file(s).`);
  } catch (error: any) {
    console.error('✕ push-env command failed:', error.message);
    process.exit(1);
  }
}

runPushEnv();
