#!/usr/bin/env node
const { execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const askQuestion = require('../utils/askQuestion');

function ensureSecureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  fs.chmodSync(dirPath, 0o700);
}

function ensureSecureFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.chmodSync(filePath, 0o600);
  }
}

function getDirectories() {
  const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf-8' }).trim();
  const gitHooksDir = execSync('git rev-parse --git-path hooks', { encoding: 'utf-8' }).trim();
  const rootDir = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();

  if (!fs.existsSync(gitDir) || !fs.existsSync(rootDir)) {
    throw new Error('Not a Git repository. Please run this script inside a Git repository.');
  }

  const huskyDir = path.join(process.cwd(), '.husky');
  const targetHook = fs.existsSync(huskyDir) ? huskyDir : gitHooksDir;

  return { gitHooksDir: targetHook, rootDir };
}

async function confirmSetup() {
  console.log('\n🔐 git-env-share setup');
  console.log('This will update your Git config, add a .secret filter, create or update .agerecipients and .gitattributes, and install a pre-commit hook.');

  const answer = await askQuestion('Do you want to continue with the setup?');
  if (!answer) {
    console.log('Setup cancelled. No repository files were modified.');
    process.exit(0);
  }
}

function configureGitHooks(gitHooksDir) {
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
  const answer = askQuestion('Append git-env-share to the existing hook and keep the current hook behavior?');

  if (!answer) {
    console.log('Skipped hook installation to avoid modifying the existing pre-commit hook.');
    return;
  }

  const updatedContent = `${existingContent}\n\n# Added by git-env-share\n${hookCommand}\n`;
  fs.writeFileSync(precommitHookPath, updatedContent, { mode: 0o755 });
  console.log('✓ Appended git-env-share pre-commit hook');
}

function configureGitAgeScripts(rootDir) {
  const recipientsPath = path.join(rootDir, '.agerecipients');
  const attributesPath = path.join(rootDir, '.gitattributes');

  execSync('git config --local filter.git-age.clean cat');
  execSync('git config --local filter.git-age.smudge "npx git-env-share-smudge"');
  execSync('git config --local filter.git-age.required true');

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

async function generateAgeKeyPair(recipientsPath) {
  const keyDir = path.join(os.homedir(), '.age');
  const keyPath = path.join(keyDir, 'key.txt');

  ensureSecureDirectory(keyDir);

  if (fs.existsSync(keyPath)) {
    ensureSecureFile(keyPath);
    console.log(`✓ Age keypair already exists at ${keyPath}`);
    return;
  }

  console.log('\n🔑 No Age keypair detected at ~/.age/key.txt');
  const answer = await askQuestion('Generate a new Age keypair now?');

  if (!answer) {
    console.log('⚠ Skipping key generation. You will need to create ~/.age/key.txt manually before pulling/decrypting.');
    return;
  }

  try {
    execSync(`age-keygen -o "${keyPath}"`);
    fs.chmodSync(keyPath, 0o600);
    console.log(`✓ Generated private key at ${keyPath}`);

    const pubKeyOutput = execSync(`age-keygen -y "${keyPath}"`, { encoding: 'utf-8' }).trim();
    console.log(`\nYour Public Key: ${pubKeyOutput}`);

    const recipientsContent = fs.existsSync(recipientsPath)
      ? fs.readFileSync(recipientsPath, 'utf-8')
      : '';

    if (!recipientsContent.includes(pubKeyOutput)) {
      const shouldAdd = await askQuestion('Add this public key to .agerecipients so the repo can encrypt files for you?');
      if (shouldAdd) {
        fs.appendFileSync(recipientsPath, `\n# Added automatically during setup\n${pubKeyOutput}\n`);
        console.log('✓ Added public key to project .agerecipients file.');
      }
    }
  } catch (err) {
    console.error('✕ Key generation failed. Ensure "age" CLI is installed globally (e.g., brew install age).');
  }
}

async function setup() {
  try {
    const { gitHooksDir, rootDir } = getDirectories();

    await confirmSetup();
    configureGitHooks(gitHooksDir);
    const recipientsPath = configureGitAgeScripts(rootDir);
    await generateAgeKeyPair(recipientsPath);

    console.log('\n✅ git-env-share is configured.');
    console.log('Next steps:');
    console.log('  1. Share your public key with the repo admin');
    console.log('  2. Commit an .env file to trigger encryption');
    console.log('  3. Run the project as usual; .secret.* files will be tracked instead of raw .env values');
  } catch (err) {
    console.log('git-env-share: Not inside a Git repository. Skipping setup.');
  }
}

setup().catch((err) => {
  console.error('✕ Setup failed:', err);
});
