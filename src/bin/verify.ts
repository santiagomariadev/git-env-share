#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getGitRoot } from '../utils/git';
import { getEnvMigrationSafetyState } from '../utils/envWorkflow';
import { describeAgeCiphertextHeaders, isAgeCiphertext } from '../utils/ageCiphertext';

function listTrackedSecretEnvFiles(rootDir: string): string[] {
  const result = spawnSync('git', ['ls-files', '--', '.secret.env*'], {
    cwd: rootDir,
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    return [];
  }

  return (result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

export interface VerifyIssues {
  trackedRawEnvFiles: string[];
  nonCiphertextSecretFiles: string[];
}

export function collectVerifyIssues(rootDir = getGitRoot()): VerifyIssues {
  const migrationState = getEnvMigrationSafetyState(rootDir);
  const trackedSecretFiles = listTrackedSecretEnvFiles(rootDir);
  const nonCiphertextSecretFiles: string[] = [];

  for (const relativeSecretPath of trackedSecretFiles) {
    const absoluteSecretPath = path.join(rootDir, relativeSecretPath);
    if (!fs.existsSync(absoluteSecretPath)) {
      nonCiphertextSecretFiles.push(relativeSecretPath);
      continue;
    }

    const content = fs.readFileSync(absoluteSecretPath);
    if (!isAgeCiphertext(content)) {
      nonCiphertextSecretFiles.push(relativeSecretPath);
    }
  }

  return {
    trackedRawEnvFiles: migrationState.trackedRawEnvFiles,
    nonCiphertextSecretFiles,
  };
}

export function runVerify() {
  try {
    const rootDir = getGitRoot();
    const issues = collectVerifyIssues(rootDir);

    if (issues.trackedRawEnvFiles.length > 0 || issues.nonCiphertextSecretFiles.length > 0) {
      console.error('✕ Verification failed.');

      if (issues.trackedRawEnvFiles.length > 0) {
        console.error('Tracked raw .env files were found in Git:');
        for (const filePath of issues.trackedRawEnvFiles) {
          console.error(`  - ${filePath}`);
        }
      }

      if (issues.nonCiphertextSecretFiles.length > 0) {
        console.error('Tracked .secret.env* files that are not valid age ciphertext:');
        for (const filePath of issues.nonCiphertextSecretFiles) {
          console.error(`  - ${filePath}`);
        }
        console.error(
          `Expected each .secret.env* file to start with ${describeAgeCiphertextHeaders()}.`,
        );
      }

      process.exit(1);
    }

    console.log('✓ Verification passed.');
    console.log(
      'All tracked .secret.env* files are age ciphertext and no raw .env* files are tracked.',
    );
  } catch (error: any) {
    console.error('✕ verify command failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  runVerify();
}
