#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ENCRYPTION_KEYS, ENCRYPTION_TRIGGERS } from '../config/defaults';
import { askBooleanQuestion } from '../utils/askQuestion';
import { ensureSecureDirectory, ensureSecureFile } from '../utils/files';
import { getGitHooksDir, getGitRoot } from '../utils/git';
import { loadGitEnvShareConfig, resolvePrivateKeyPath } from '../config';
import { syncGitHubRecipientsFromConfig } from '../utils/sshEnvEncryption';

export type SetupOptions = {
  dryRun: boolean;
  encryptionTrigger?: 'manual' | 'commit' | string;
};

export function parseSetupOptions(argv: string[] = process.argv.slice(2)): SetupOptions {
  const result: SetupOptions = { dryRun: false, encryptionTrigger: ENCRYPTION_TRIGGERS.COMMIT };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const nextValue = argv[index + 1];

    if (value === '--dry-run' || value === '-n') {
      result.dryRun = true;
      continue;
    }

    if (value === '--trigger' || value === '-t') {
      if (nextValue && !nextValue.startsWith('-')) {
        result.encryptionTrigger = nextValue.toLowerCase();
        index += 1;
      }
      continue;
    }

    if (value.startsWith('--trigger=')) {
      result.encryptionTrigger = value.slice('--trigger='.length).toLowerCase();
      continue;
    }
  }

  if (result.encryptionTrigger !== ENCRYPTION_TRIGGERS.MANUAL && result.encryptionTrigger !== ENCRYPTION_TRIGGERS.COMMIT) {
    result.encryptionTrigger = ENCRYPTION_TRIGGERS.COMMIT;
  }

  return result;
}

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

async function confirmSetup(dryRun = false) {
  console.log('\n🔐 git-env-share setup');
  if (dryRun) {
    console.log('Preview mode: showing the repository changes that would be made without writing files.');
    return;
  }

  console.log('This will configure the Git filter, update .agerecipients and .gitattributes, and optionally install a pre-commit hook.');

  const answer = await askBooleanQuestion('Do you want to continue with the setup?');
  if (!answer) {
    console.log('Setup cancelled. No repository files were modified.');
    process.exit(0);
  }
}

async function configureGitHooks(gitHooksDir: string, dryRun = false) {
  const precommitHookPath = path.join(gitHooksDir, 'pre-commit');
  const hookCommand = 'npx git-env-share-precommit';
  const hookScriptHeader = '#!/bin/sh\n# git-env-share pre-commit hook\n';

  if (dryRun) {
    if (!fs.existsSync(precommitHookPath)) {
      console.log(`Preview: would create pre-commit hook at ${precommitHookPath} with:\n${hookScriptHeader}${hookCommand}\n`);
      return;
    }

    const existingContent = fs.readFileSync(precommitHookPath, 'utf-8');
    if (existingContent.includes(hookCommand)) {
      console.log(`Preview: git-env-share hook already present in ${precommitHookPath}; no change required.`);
      return;
    }

    console.log(`Preview: would append git-env-share to ${precommitHookPath}:\n${hookCommand}\n`);
    return;
  }

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

function configureGitAgeScripts(rootDir: string, dryRun = false) {
  const recipientsPath = path.join(rootDir, '.agerecipients');
  const attributesPath = path.join(rootDir, '.gitattributes');

  if (dryRun) {
    console.log('Preview: would configure local Git filters:');
    console.log('  - filter.git-age.clean = cat');
    console.log('  - filter.git-age.smudge = npx git-env-share-smudge %f');
    console.log('  - filter.git-age.required = true');
    console.log(`Preview: would ensure ${recipientsPath} exists and contains age public keys.`);
    console.log(`Preview: would add ".secret.env* filter=git-age" to ${attributesPath} if it is not already present.`);
    return recipientsPath;
  }

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

  const envRules = ['.secret.env* filter=git-age'];

  if (!attributesContent.includes('filter=git-age')) {
    const attributeLines = [
      '',
      '# Encrypt environment files with git-env-share',
      ...envRules,
      ''
    ];
    attributesContent += attributeLines.join('\n');
    fs.writeFileSync(attributesPath, attributesContent);
    console.log('✓ Added .secret.env* filter rule to .gitattributes');
  }

  console.log('✓ Successfully configured git-env-share filter drivers.');
  return recipientsPath;
}

async function generateAgeKeyPair(recipientsPath: string, dryRun = false) {
  const rootDir = process.cwd();
  const config = loadGitEnvShareConfig(rootDir);
  const keyPath = resolvePrivateKeyPath(config, rootDir);

  if (dryRun) {
    if (config.encryptionKey === ENCRYPTION_KEYS.SSH) {
      console.log(`Preview: would ensure the SSH private key exists at ${keyPath} and that GitHub public keys are synced into ${recipientsPath}.`);
      return;
    }

    console.log(`Preview: would generate an Age keypair at ${keyPath} if one is not already present.`);
    console.log(`Preview: would add the matching public key to ${recipientsPath} if it is not already present.`);
    return;
  }

  if (config.encryptionKey === 'ssh') {
    if (fs.existsSync(keyPath || '')) {
      console.log(`✓ SSH private key already exists at ${keyPath}`);
      return;
    }

    console.log(`\n🔑 SSH encryption enabled. Ensure your private key exists at ${keyPath} and that your GitHub public key is authorized by the repository admin.`);
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

export async function setup(argv: string[] = process.argv.slice(2)) {
  try {
    const { gitHooksDir, rootDir } = getDirectories();
    const options = parseSetupOptions(argv);
    const config = loadGitEnvShareConfig(rootDir);
    const effectiveConfig = options.encryptionTrigger ? { ...config, encryptionTrigger: options.encryptionTrigger } : config;

    await confirmSetup(options.dryRun);

    if (effectiveConfig.encryptionTrigger === ENCRYPTION_TRIGGERS.COMMIT) {
      await configureGitHooks(gitHooksDir, options.dryRun);
    }

    const recipientsPath = configureGitAgeScripts(rootDir, options.dryRun);

    if (effectiveConfig.encryptionKey === ENCRYPTION_KEYS.SSH) {
      console.log('✓ SSH encryption is enabled. The project will expect GitHub SSH recipients to be listed in .agerecipients.');
      if (options.dryRun) {
        console.log(`Preview: would sync GitHub SSH recipients into ${recipientsPath}.`);
      } else {
        const syncedKeys = await syncGitHubRecipientsFromConfig(rootDir);
        if (syncedKeys.length > 0) {
          console.log(`✓ Synced ${syncedKeys.length} GitHub SSH key(s) into ${recipientsPath}.`);
        } else {
          console.log(`✓ Rebuilt ${recipientsPath} for SSH encryption. No GitHub usernames were configured.`);
        }
      }
    } else {
      await generateAgeKeyPair(recipientsPath, options.dryRun);
    }

    if (options.dryRun) {
      console.log('\nPreview complete. No files were modified. Run the same command without --dry-run to apply these changes.');
      return;
    }

    console.log('\n✅ git-env-share is configured.');
    console.log(`Current setup: ${effectiveConfig.encryptionKey === ENCRYPTION_KEYS.SSH ? 'SSH' : 'Age'} encryption with ${effectiveConfig.encryptionTrigger === ENCRYPTION_TRIGGERS.MANUAL ? 'manual' : 'commit-time'} trigger.`);
    console.log('Next steps:');
    if (effectiveConfig.encryptionTrigger === ENCRYPTION_TRIGGERS.COMMIT) {
      console.log('  1. Share your public key or GitHub username with the repo admin.');
      console.log('  2. Edit a local .env file and commit normally; the pre-commit hook will encrypt it before the commit succeeds.');
      console.log('  3. Continue tracking only the encrypted .secret.* files, while raw .env values remain local-only.');
    } else {
      console.log('  1. Share your public key or GitHub username with the repo admin.');
      console.log('  2. Run "npx git-env-share-stage-env" when you want to encrypt and stage the current .env files.');
      console.log('  3. Run "npx git-env-share-push-env" to encrypt, stage, and commit in one command.');
    }
    console.log('');
    console.log('Migration note: switching between commit and manual triggers only changes when encryption runs; it does not change the encrypted file naming or the Git filter setup.');
  } catch {
    console.log('git-env-share: Not inside a Git repository. Skipping setup.');
  }
}
