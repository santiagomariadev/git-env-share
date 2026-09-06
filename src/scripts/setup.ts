#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { askBooleanQuestion } from '../utils/askQuestion';
import { ensureSecureDirectory, ensureSecureFile } from '../utils/files';
import { getGitHooksDir, getGitRoot } from '../utils/git';
import { loadGitEnvShareConfig, resolvePrivateKeyPath } from '../config';
import { syncGitHubRecipientsFromConfig } from '../utils/sshEnvEncryption';

function getDirectories() {
  const gitHooksDir = getGitHooksDir();
  const rootDir = getGitRoot();

  if (!fs.existsSync(rootDir)) {
    throw new Error('Not a Git repository. Please run this script inside a Git repository.');
  }

  const huskyDir = path.join(process.cwd(), '.husky');
  const targetHook = fs.existsSync(huskyDir) ? huskyDir : gitHooksDir;

  return { gitHooksDir: targetHook, rootDir };
}

async function confirmSetup() {
  console.log('\n🔐 git-env-share setup');
  console.log('This will update your Git config, add a .secret filter, create or update .agerecipients and .gitattributes, and install a pre-commit hook.');

  const answer = await askBooleanQuestion('Do you want to continue with the setup?');
  if (!answer) {
    console.log('Setup cancelled. No repository files were modified.');
    process.exit(0);
  }
}

async function configureGitHooks(gitHooksDir: string) {
  const precommitHookPath = path.join(gitHooksDir, 'pre-commit');
  const hookCommand = 'npx git-env-share-precommit';
  const hookScriptHeader = '#!/bin/sh\n# git-env-share pre-commit hook\n';

  if (!fs.existsSync(precommitHookPath)) {
    fs.writeFileSync(precommitHookPath, `${hookScriptHeader}\n${hookCommand}\n`, { mode: 0o755 });
    console.log('✓ Created pre-commit hook at', precommitHookPath);
    return;
  }

  const existingContent = fs.readFileSync(precommitHookPath, 'utf-8');
  if (existingContent.includes(hookCommand)) {
    console.log('✓ git-env-share hook already present in pre-commit');
    return;
  }

  console.log('⚠ A pre-commit hook already exists in this repository.');
  const answer = await askBooleanQuestion('Append git-env-share to the existing hook and keep the current hook behavior?');

  if (!answer) {
    console.log('Skipped hook installation to avoid modifying the existing pre-commit hook.');
    return;
  }

  const updatedContent = `${existingContent}\n\n# Added by git-env-share\n${hookCommand}\n`;
  fs.writeFileSync(precommitHookPath, updatedContent, { mode: 0o755 });
  console.log('✓ Appended git-env-share pre-commit hook');
}

function configureGitAgeScripts(rootDir: string) {
  const recipientsPath = path.join(rootDir, '.agerecipients');
  const attributesPath = path.join(rootDir, '.gitattributes');

  spawnSync('git', ['config', '--local', 'filter.git-age.clean', 'cat'], { stdio: 'inherit' });
  spawnSync('git', ['config', '--local', 'filter.git-age.smudge', 'npx git-env-share-smudge %f'], { stdio: 'inherit' });
  spawnSync('git', ['config', '--local', 'filter.git-age.required', 'true'], { stdio: 'inherit' });

  if (!fs.existsSync(recipientsPath)) {
    fs.writeFileSync(recipientsPath, '# Add age public keys (one per line)\n');
    console.log('✓ Created .agerecipients file.');
  }

  let attributesContent = fs.existsSync(attributesPath)
    ? fs.readFileSync(attributesPath, 'utf-8')
    : '';

  if (!attributesContent.includes('filter=git-age')) {
    const attributeLines = [
      '',
      '# Encrypt secret files with git-env-share',
      '.secret.env* filter=git-age',
      ''
    ];
    attributesContent += attributeLines.join('\n');
    fs.writeFileSync(attributesPath, attributesContent);
    console.log('✓ Added .secret.env* rule to .gitattributes');
  }

  console.log('✓ Successfully configured git-env-share filter drivers.');
  return recipientsPath;
}

async function generateAgeKeyPair(recipientsPath: string) {
  const rootDir = process.cwd();
  const config = loadGitEnvShareConfig(rootDir);
  const keyPath = resolvePrivateKeyPath(config, rootDir);

  if (config.mode === 'ssh') {
    if (fs.existsSync(keyPath || '')) {
      console.log(`✓ SSH private key already exists at ${keyPath}`);
      return;
    }

    console.log(`\n🔑 SSH mode enabled. Ensure your private key exists at ${keyPath} and that your GitHub public key is authorized by the repository admin.`);
    return;
  }

  const keyDir = path.dirname(keyPath || path.join(process.cwd(), '.age'));
  ensureSecureDirectory(keyDir);

  if (fs.existsSync(keyPath || '')) {
    ensureSecureFile(keyPath || '');
    console.log(`✓ Age keypair already exists at ${keyPath}`);
    return;
  }

  console.log(`\n🔑 No Age keypair detected at ${keyPath}`);
  const answer = await askBooleanQuestion('Generate a new Age keypair now?');

  if (!answer) {
    console.log(`⚠ Skipping key generation. You will need to create ${keyPath} manually before pulling/decrypting.`);
    return;
  }

  try {
    if (!keyPath) {
      throw new Error('No Age key path could be resolved.');
    }

    spawnSync('age-keygen', ['-o', keyPath], { stdio: 'inherit' });
    fs.chmodSync(keyPath, 0o600);
    console.log(`✓ Generated private key at ${keyPath}`);

    if (!keyPath) {
      throw new Error('No Age key path could be resolved.');
    }

    const pubKeyOutput = spawnSync('age-keygen', ['-y', keyPath], { encoding: 'utf-8' }).stdout.trim();
    console.log(`\nYour Public Key: ${pubKeyOutput}`);

    const recipientsContent = fs.existsSync(recipientsPath)
      ? fs.readFileSync(recipientsPath, 'utf-8')
      : '';

    if (!recipientsContent.includes(pubKeyOutput)) {
      const shouldAdd = await askBooleanQuestion('Add this public key to .agerecipients so the repo can encrypt files for you?');
      if (shouldAdd) {
        fs.appendFileSync(recipientsPath, `\n# Added automatically during setup\n${pubKeyOutput}\n`);
        console.log('✓ Added public key to project .agerecipients file.');
      }
    }
  } catch {
    console.error('✕ Key generation failed. Ensure "age" CLI is installed globally (e.g., brew install age).');
  }
}

export async function setup() {
  try {
    const { gitHooksDir, rootDir } = getDirectories();

    await confirmSetup();
    await configureGitHooks(gitHooksDir);
    const recipientsPath = configureGitAgeScripts(rootDir);
    const config = loadGitEnvShareConfig(rootDir);

    if (config.mode === 'ssh') {
      console.log('✓ SSH mode is enabled. The project will expect GitHub SSH recipients to be listed in .agerecipients.');
      const syncedKeys = await syncGitHubRecipientsFromConfig(rootDir);
      if (syncedKeys.length > 0) {
        console.log(`✓ Synced ${syncedKeys.length} GitHub SSH key(s) into ${recipientsPath}.`);
      } else {
        console.log(`✓ Rebuilt ${recipientsPath} for SSH mode. No GitHub usernames were configured.`);
      }
    } else {
      await generateAgeKeyPair(recipientsPath);
    }

    console.log('\n✅ git-env-share is configured.');
    console.log('Next steps:');
    console.log('  1. Share your public key with the repo admin');
    console.log('  2. Commit an .env file to trigger encryption');
    console.log('  3. Run the project as usual; .secret.* files will be tracked instead of raw .env values');
  } catch {
    console.log('git-env-share: Not inside a Git repository. Skipping setup.');
  }
}
