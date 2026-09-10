#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ENCRYPTION_KEYS, ENCRYPTION_TRIGGERS } from '../config/defaults';
import { askBooleanQuestion } from '../utils/askQuestion';
import { ensureSecureDirectory, ensureSecureFile } from '../utils/files';
import { getGitHooksDir, getGitRoot } from '../utils/git';
import { ensureRecipientsFile, readRecipientsFileContent, resolveRecipientsPath } from '../utils/recipientsFile';
import { normalizeLineEndings } from '../utils/text';
import { loadGitEnvShareConfig, resolvePrivateKeyPath } from '../config';
import { warnAboutUnsafeRawEnvGitState } from '../utils/envWorkflow';
import { syncGitHubRecipientsFromConfig } from '../utils/sshEnvEncryption';

export type SetupOptions = {
  dryRun: boolean;
  encryptionTrigger?: 'manual' | 'commit' | string;
};

const SECRET_ENV_RULE = '.secret.env* filter=git-age';
const ATTRIBUTES_COMMENT = '# Encrypt environment files with git-env-share';

export function parseSetupOptions(argv: string[] = process.argv.slice(2)): SetupOptions {
  const result: SetupOptions = { dryRun: false };

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

  if (result.encryptionTrigger
    && result.encryptionTrigger !== ENCRYPTION_TRIGGERS.MANUAL
    && result.encryptionTrigger !== ENCRYPTION_TRIGGERS.COMMIT) {
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
  const hookCommand = 'npx ges precommit';
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

export function stripGitEnvShareHookLines(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed !== 'npx ges precommit' && trimmed !== '# Added by git-env-share' && trimmed !== '# git-env-share pre-commit hook';
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd() + '\n';
}

export function isManagedByGitEnvShareOnly(content: string): boolean {
  const remaining = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => line !== '#!/bin/sh' && line !== 'npx ges precommit' && line !== '# Added by git-env-share' && line !== '# git-env-share pre-commit hook');

  return remaining.length === 0;
}

export async function configureManualModeHookState(gitHooksDir: string, dryRun = false) {
  const precommitHookPath = path.join(gitHooksDir, 'pre-commit');

  if (!fs.existsSync(precommitHookPath)) {
    return;
  }

  const existingContent = fs.readFileSync(precommitHookPath, 'utf-8');
  if (!existingContent.includes('npx ges precommit')) {
    return;
  }

  const managedOnly = isManagedByGitEnvShareOnly(existingContent);
  if (dryRun) {
    if (managedOnly) {
      console.log(`Preview: would remove ${precommitHookPath} because manual mode does not require the git-env-share pre-commit hook.`);
      return;
    }

    console.log(`Preview: would remove "npx ges precommit" from ${precommitHookPath} so manual mode does not run commit-time encryption.`);
    return;
  }

  if (managedOnly) {
    fs.unlinkSync(precommitHookPath);
    console.log('✓ Removed git-env-share pre-commit hook for manual mode.');
    return;
  }

  console.log('⚠ Manual mode was selected, but an existing pre-commit hook still contains "npx ges precommit".');
  const shouldRemove = await askBooleanQuestion('Remove only the git-env-share line and keep the rest of the hook?');
  if (!shouldRemove) {
    console.log('Kept existing hook unchanged. Commit-time hook logic may still run until you remove that line manually.');
    return;
  }

  fs.writeFileSync(precommitHookPath, stripGitEnvShareHookLines(existingContent), { mode: 0o755 });
  console.log('✓ Removed git-env-share command from existing pre-commit hook for manual mode.');
}

export function upsertSecretEnvGitAttributeRule(content: string): { content: string; changed: boolean } {
  const normalized = normalizeLineEndings(content || '');
  const lines = normalized.length > 0 ? normalized.split('\n') : [];
  const hasRule = lines.some((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return false;

    const tokens = trimmed.split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || tokens[0] !== '.secret.env*') return false;

    return tokens.some((token) => token === 'filter=git-age');
  });
  const hasComment = lines.some((line) => line.trim() === ATTRIBUTES_COMMENT);

  if (hasRule && hasComment) {
    return { content: normalized.endsWith('\n') ? normalized : `${normalized}\n`, changed: false };
  }

  const outputLines = [...lines.filter((line) => line.length > 0 || lines.length === 0)];
  if (outputLines.length > 0 && outputLines[outputLines.length - 1].trim() !== '') {
    outputLines.push('');
  }

  if (!hasComment) {
    outputLines.push(ATTRIBUTES_COMMENT);
  }

  if (!hasRule) {
    outputLines.push(SECRET_ENV_RULE);
  }

  const updated = `${outputLines.join('\n')}\n`;
  return { content: updated, changed: true };
}

function configureGitAgeScripts(rootDir: string, dryRun = false) {
  const config = loadGitEnvShareConfig(rootDir);
  const recipientsPath = resolveRecipientsPath(rootDir, config);
  const attributesPath = path.join(rootDir, '.gitattributes');

  if (dryRun) {
    console.log('Preview: would configure local Git filters:');
    console.log('  - filter.git-age.clean = cat');
    console.log('  - filter.git-age.smudge = npx ges smudge %f');
    console.log('  - filter.git-age.required = true');
    console.log(`Preview: would ensure ${recipientsPath} exists and contains age public keys.`);
    console.log(`Preview: would ensure "${SECRET_ENV_RULE}" exists in ${attributesPath}.`);
    return recipientsPath;
  }

  spawnSync('git', ['config', '--local', 'filter.git-age.clean', 'cat'], { stdio: 'inherit' });
  spawnSync('git', ['config', '--local', 'filter.git-age.smudge', 'npx ges smudge %f'], { stdio: 'inherit' });
  spawnSync('git', ['config', '--local', 'filter.git-age.required', 'true'], { stdio: 'inherit' });

  if (!fs.existsSync(recipientsPath)) {
    ensureRecipientsFile(recipientsPath, '# Add age public keys (one per line)\n');
    console.log('✓ Created .agerecipients file.');
  }

  const existingAttributes = fs.existsSync(attributesPath)
    ? fs.readFileSync(attributesPath, 'utf-8')
    : '';

  const upsertResult = upsertSecretEnvGitAttributeRule(existingAttributes);

  if (upsertResult.changed) {
    fs.writeFileSync(attributesPath, upsertResult.content);
    console.log(`✓ Ensured ${SECRET_ENV_RULE} in .gitattributes`);
  } else {
    console.log(`✓ ${SECRET_ENV_RULE} already present in .gitattributes`);
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

    const recipientsContent = readRecipientsFileContent(recipientsPath);

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

function printSetupSummary(rootDir: string, recipientsPath: string, effectiveConfig: { encryptionKey?: string; encryptionTrigger?: string }): void {
  const modeLabel = effectiveConfig.encryptionKey === ENCRYPTION_KEYS.SSH ? 'SSH' : 'Age';
  const triggerLabel = effectiveConfig.encryptionTrigger === ENCRYPTION_TRIGGERS.MANUAL ? 'manual' : 'commit';

  console.log('\n✅ Setup complete.');
  console.log(`Active mode: ${modeLabel}`);
  console.log(`Active trigger: ${triggerLabel}`);
  console.log(`Recipients file: ${path.relative(rootDir, recipientsPath) || '.agerecipients'}`);
  console.log('Repo expectations:');
  console.log('  - Track encrypted .secret.env* files in Git.');
  console.log('  - Keep raw .env* values local-only and untracked.');
  console.log(`  - .gitattributes includes: ${SECRET_ENV_RULE}`);
  console.log('Next commands:');

  if (triggerLabel === ENCRYPTION_TRIGGERS.MANUAL) {
    console.log('  1. npx ges stage');
    console.log('  2. git commit -m "security: refresh encrypted env files"');
    console.log('  3. npx ges push -m "security: refresh encrypted env files"  # optional one-step commit');
  } else {
    console.log('  1. Edit a local .env file');
    console.log('  2. git add -f .env  # if .env is ignored and you want the commit hook to process changes');
    console.log('  3. git commit -m "security: refresh encrypted env files"');
  }
}

export async function setup(argv: string[] = process.argv.slice(2)) {
  try {
    const { gitHooksDir, rootDir } = getDirectories();
    const options = parseSetupOptions(argv);
    const config = loadGitEnvShareConfig(rootDir);
    const effectiveConfig = options.encryptionTrigger ? { ...config, encryptionTrigger: options.encryptionTrigger } : config;

    await confirmSetup(options.dryRun);

    if (effectiveConfig.encryptionTrigger === ENCRYPTION_TRIGGERS.MANUAL) {
      await configureManualModeHookState(gitHooksDir, options.dryRun);
    }

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
      warnAboutUnsafeRawEnvGitState(rootDir);
      console.log('\nPreview complete. No files were modified. Run the same command without --dry-run to apply these changes.');
      return;
    }

    warnAboutUnsafeRawEnvGitState(rootDir);

    printSetupSummary(rootDir, recipientsPath, effectiveConfig);
    console.log('Migration note: switching between commit and manual triggers only changes when encryption runs; encrypted file naming and filter wiring stay the same.');
  } catch {
    console.log('git-env-share: Not inside a Git repository. Skipping setup.');
  }
}
