#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { loadGitEnvShareConfig } from '../config';
import { getRemoteGitUrl } from '../utils/git';
import { getEnvFilesAndUpdateGitIgnore, stageEnvSecrets } from '../utils/envWorkflow';

export function shouldRunPreCommitHook(projectRoot = process.cwd()): boolean {
  const config = loadGitEnvShareConfig(projectRoot);
  return config.enabled !== false && !config.paused && config.encryptionTrigger === 'commit';
}

function verifyGitAccess() {
  const remoteUrl = getRemoteGitUrl();

  if (!remoteUrl) {
    console.error('✕ Git Access Denied: No remote URL found for the repository.');
    process.exit(1);
  }

  const sshCheck = spawnSync('ssh', [
    '-T',
    '-o',
    'BatchMode=yes',
    remoteUrl.replace(/^(git@|https:\/\/)/, '').replace(/:.*/, '')
  ], { encoding: 'utf-8' });

  if (sshCheck.status === 255) {
    console.error('✕ Git Access Denied: SSH connection failed. Please check your SSH keys and configuration.');
    process.exit(1);
  }

  const sshOutput = (sshCheck.stdout || '') + (sshCheck.stderr || '');

  if (!sshOutput.includes("You've successfully authenticated")) {
    console.error('✕ Git Access Denied: Cannot authenticate against repository remote.');
    process.exit(1);
  }
}

export function runPreCommit() {
  try {
    const rootDir = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).stdout.trim();

    if (!shouldRunPreCommitHook(rootDir)) {
      console.log('git-env-share: pre-commit hook skipped because paused or encryptionTrigger is not "commit".');
      return;
    }

    const gitRemoteUrl = getRemoteGitUrl();

    if (!gitRemoteUrl) {
      console.log('⚠ No remote URL found. Fallback to checking for .env files and updating .gitignore only.');
      getEnvFilesAndUpdateGitIgnore();
      return;
    }

    verifyGitAccess();
    stageEnvSecrets(rootDir);

    process.exit(0);
  } catch (error: any) {
    console.error('✕ pre-commit hook error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  runPreCommit();
}
