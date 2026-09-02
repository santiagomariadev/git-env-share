#!/usr/bin/env node
import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadGitEnvShareConfig } from '../config';
import { getRemoteGitUrl, gitAdd, gitResetPaths, gitRestoreStaged } from '../utils/git';

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

function validateAgeRecipients(rootDir: string) {
  const config = loadGitEnvShareConfig(rootDir);
  const recipientsPath = path.join(rootDir, config.recipientsFile || '.agerecipients');

  if (!fs.existsSync(recipientsPath)) {
    fs.writeFileSync(recipientsPath, '# Add age or SSH public keys (one per line)\n');
    console.log('✓ Created recipients file for the configured mode:', config.mode);
  }

  return recipientsPath;
}

function getEnvFilesAndUpdateGitIgnore() {
  const gitIgnorePath = '.gitignore';

  if (!fs.existsSync(gitIgnorePath)) {
    fs.writeFileSync(gitIgnorePath, '');
    console.log('✓ Created .gitignore file.');
  }

  const envFiles = execSync('ls .env* 2>/dev/null || true', { encoding: 'utf-8' }).split('\n').filter(Boolean);

  let gitIgnoreContent = fs.readFileSync(gitIgnorePath, 'utf-8');
  let updated = false;

  gitIgnoreContent += `\n# Missing .env files, added by git-env-share for security`;
  envFiles.forEach((file) => {
    if (!gitIgnoreContent.match(new RegExp(`^${file}$`, 'm'))) {
      gitIgnoreContent += `\n${file}`;
      updated = true;
    }
  });

  if (updated) {
    fs.writeFileSync(gitIgnorePath, gitIgnoreContent);
    console.log('✓ Updated .gitignore with missing .env files.');
  }

  gitResetPaths(envFiles);
  gitAdd(gitIgnorePath);

  return envFiles;
}

function secureEnvFile(rootDir: string, envFilePath: string, recipientsPath: string) {
  const fullPath = path.join(rootDir, envFilePath);

  if (fs.existsSync(fullPath)) {
    const dir = path.dirname(fullPath);
    const baseName = path.basename(fullPath);

    const secretFileName = `.secret${baseName}`;
    const secretFilePath = path.join(dir, secretFileName);
    const relativeSecretPath = path.relative(rootDir, secretFilePath);

    if (!fs.existsSync(secretFilePath)) {
      fs.writeFileSync(secretFilePath, '');
      console.log(`✓ Generated placeholder: ${relativeSecretPath}`);
    }

    const envContent = fs.readFileSync(fullPath);
    const ageProcess = spawnSync('age', ['-R', recipientsPath, '-e'], {
      input: envContent,
      maxBuffer: 1024 * 1024 * 50
    });

    if (ageProcess.status !== 0) {
      console.error(`✕ Encryption failed for ${envFilePath}:`, ageProcess.stderr?.toString());
      process.exit(1);
    }

    fs.writeFileSync(secretFilePath, ageProcess.stdout);
    gitRestoreStaged(envFilePath);
    console.log(`✓ Unstaged raw file: ${envFilePath}`);
    gitAdd(relativeSecretPath, '.gitignore');
    console.log(`✓ Encrypted & Staged: ${relativeSecretPath}`);
  }
}

function runPreCommit() {
  try {
    const rootDir = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
    const gitRemoteUrl = getRemoteGitUrl();

    if (!gitRemoteUrl) {
      console.log('⚠ No remote URL found. Fallback to checking for .env files and updating .gitignore only.');
      getEnvFilesAndUpdateGitIgnore();
      return;
    }

    verifyGitAccess();
    const recipientsPath = validateAgeRecipients(rootDir);
    const envFiles = getEnvFilesAndUpdateGitIgnore();

    for (const relativePath of envFiles) {
      secureEnvFile(rootDir, relativePath, recipientsPath);
    }

    process.exit(0);
  } catch (error: any) {
    console.error('✕ pre-commit hook error:', error.message);
    process.exit(1);
  }
}

runPreCommit();
