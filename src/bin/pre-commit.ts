#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { ENCRYPTION_TRIGGERS } from '../config/defaults';
import { loadGitEnvShareConfig } from '../config';
import { getGitRoot, getRemoteGitUrl, shouldSkipRemoteValidation } from '../utils/git';
import { getEnvFilesAndUpdateGitIgnore, stageEnvSecrets } from '../utils/envWorkflow';

export function shouldRunPreCommitHook(projectRoot = process.cwd()): boolean {
  const config = loadGitEnvShareConfig(projectRoot);
  return config.enabled !== false && !config.paused && config.encryptionTrigger === ENCRYPTION_TRIGGERS.COMMIT;
}

function resolveSshHostFromRemote(remoteUrl: string): string | null {
  const normalized = remoteUrl.trim();

  if (normalized.startsWith('ssh://')) {
    try {
      const parsed = new URL(normalized);
      return parsed.hostname || null;
    } catch {
      return null;
    }
  }

  const scpLike = normalized.match(/^[^@\s]+@([^:\s]+):/);
  if (scpLike && scpLike[1]) {
    return scpLike[1];
  }

  return null;
}

function verifyGitAccess(remoteUrl: string) {
  const host = resolveSshHostFromRemote(remoteUrl);
  if (!host) {
    return;
  }

  if (!/^[A-Za-z0-9.-]+$/.test(host)) {
    console.error('✕ Git Access Denied: repository remote host is invalid for SSH validation.');
    process.exit(1);
  }

  const sshCheck = spawnSync('ssh', [
    '-T',
    '-o',
    'BatchMode=yes',
    host
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
    const rootDir = getGitRoot();
    const config = loadGitEnvShareConfig(rootDir);

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

    if (!shouldSkipRemoteValidation(gitRemoteUrl, config)) {
      verifyGitAccess(gitRemoteUrl);
    }

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
