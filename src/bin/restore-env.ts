#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadGitEnvShareConfig, resolvePrivateKeyPath } from '../config';
import { writeFileAtomic } from '../utils/files';
import { getGitRoot } from '../utils/git';
import { isAgeCiphertext } from '../utils/ageCiphertext';

function listTrackedSecretEnvFiles(projectRoot: string): string[] {
  const result = spawnSync('git', ['ls-files', '--', '.secret.env*'], {
    cwd: projectRoot,
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

function decryptSecretContent(content: Buffer, keyPath: string): Buffer | null {
  const ageProcess = spawnSync('age', ['-d', '-i', keyPath], {
    input: content,
    maxBuffer: 1024 * 1024 * 50,
  });

  if (ageProcess.status !== 0) {
    return null;
  }

  return ageProcess.stdout as Buffer;
}

function toEnvFilePath(secretFilePath: string): string {
  const dir = path.dirname(secretFilePath);
  const envFileName = path.basename(secretFilePath).replace(/^\.secret/, '');
  return path.join(dir, envFileName);
}

export function runRestoreEnv(_argv = process.argv.slice(2)) {
  const projectRoot = getGitRoot();
  const config = loadGitEnvShareConfig(projectRoot);
  const keyPath = resolvePrivateKeyPath(config, projectRoot);

  if (!keyPath || !fs.existsSync(keyPath)) {
    console.error('✕ Private key is missing or unreadable. Skipping env restore hooks.');
    process.exit(1);
  }

  const trackedSecretFiles = listTrackedSecretEnvFiles(projectRoot);
  if (trackedSecretFiles.length === 0) {
    return;
  }

  let restoredCount = 0;

  for (const relativeSecretPath of trackedSecretFiles) {
    const absoluteSecretPath = path.join(projectRoot, relativeSecretPath);
    if (!fs.existsSync(absoluteSecretPath)) {
      continue;
    }

    const encryptedContent = fs.readFileSync(absoluteSecretPath);
    if (!isAgeCiphertext(encryptedContent)) {
      console.error(
        `✕ Skipping ${relativeSecretPath}: tracked file is not age ciphertext. Run "npx ges verify" for details.`,
      );
      continue;
    }

    const decryptedContent = decryptSecretContent(encryptedContent, keyPath);
    if (!decryptedContent) {
      console.error(`✕ Failed to decrypt ${relativeSecretPath}.`);
      continue;
    }

    const absoluteEnvPath = toEnvFilePath(absoluteSecretPath);
    const relativeEnvPath =
      path.relative(projectRoot, absoluteEnvPath) || path.basename(absoluteEnvPath);
    const envExists = fs.existsSync(absoluteEnvPath);

    if (envExists) {
      const currentEnvContent = fs.readFileSync(absoluteEnvPath);
      if (currentEnvContent.equals(decryptedContent)) {
        continue;
      }
    }

    writeFileAtomic(absoluteEnvPath, decryptedContent);
    restoredCount += 1;
    console.error(`✓ Restored local unencrypted file: ${relativeEnvPath}`);
  }

  if (restoredCount > 0) {
    console.error(`✓ Restored ${restoredCount} local .env file(s) from tracked ciphertext.`);
  }
}

if (require.main === module) {
  runRestoreEnv();
}
