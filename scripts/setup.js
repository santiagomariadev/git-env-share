#!/usr/bin/env node
const { execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const askQuestion = require('../utils/askQuestion');

function getDirectories() {
  const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf-8' }).trim();
  const gitHooksDir = execSync('git rev-parse --git-path hooks', { encoding: 'utf-8' }).trim();
  const rootDir = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();

  if (!fs.existsSync(gitDir) || !fs.existsSync(rootDir)) {
    throw new Error('Not a Git repository. Please run this script inside a Git repository.');
  }

  const huskyDir = path.join(process.cwd(), '.husky');
  const targetHook = fs.existsSync(huskyDir)
    ? huskyDir
    : gitHooksDir

  return { gitHooksDir: targetHook, rootDir };
}

function configureGitHooks(gitHooksDir) {
  const precommitHookPath = path.join(gitHooksDir, 'pre-commit');

  // Configure pre-commit hook
  const hookCommand = 'npx git-env-share-precommit';
  const hookScriptHeader = '#!/bin/sh\n# git-env-share pre-commit hook\n';

  if (!fs.existsSync(precommitHookPath)) {
    // Create the file is it doesn't exist
    fs.writeFileSync(precommitHookPath, `${hookScriptHeader}\n${hookCommand}\n`, { mode: 0o755 });
    console.log('✓ Created pre-commit hook at', precommitHookPath);
  } else {
    const existingContent = fs.readFileSync(precommitHookPath, 'utf-8');

    // Skip if already configured
    if (existingContent.includes(hookCommand)) {
      console.log('✓ git-env-share hook already present in pre-commit');
      return;
    }

    // Append config if another hook already exists
    const updatedContent = `${existingContent}\n\n# Added by git-env-share\n${hookCommand}\n`;
    fs.writeFileSync(precommitHookPath, updatedContent, { mode: 0o755 });
    console.log('✓ Appended git-env-share pre-commit hook');
  }
}

function configureGitAgeScripts(rootDir) {
  // Required file paths
  const recipientsPath = path.join(rootDir, '.agerecipients');
  const attributesPath = path.join(rootDir, '.gitattributes');

  // Configure local Git filter drivers
  execSync('git config filter.git-age.clean cat');
  execSync('git config filter.git-age.smudge "npx git-env-share-smudge"');
  execSync('git config filter.git-age.required true');
  
  //  Check for .agerecipients file and create it if it doesn't exist
  if (!fs.existsSync(recipientsPath)) {
    fs.writeFileSync(recipientsPath, '# Add age public keys (one per line)\n');
    console.log('✓ Created .agerecipients file.');
  }

  // Get .gitattributes content
  let attributesContent = fs.existsSync(attributesPath)
    ? fs.readFileSync(attributesPath, 'utf-8')
    : '';
  
  // Check for existing *.secret rule and add it if it doesn't exist
  if (!attributesContent.includes('filter=git-age')) {
    const attributeLines = [
      '',
      '# Encrypt secret files with git-env-share',
      '.secret.env* filter=git-age',
      ''
    ];
    attributesContent += attributeLines.join('\n');

    fs.writeFileSync(attributesPath, attributesContent);
    console.log('✓ Added *.secret rule to .gitattributes');
  }

  console.log('✓ Successfully configured git-env-share filter drivers!');

  return recipientsPath;
}

async function generateAgeKeyPair(recipientsPath) {
  // Prompt user to confirm if they want to create key pair if none exists
  const keyDir = path.join(os.homedir(), '.age');
  const keyPath = path.join(keyDir, 'key.txt');

  if (fs.existsSync(keyPath)) {
    console.log(`✓ Age keypair already exists at ${keyPath}`);
    return;
  }

  console.log('\n🔑 No Age keypair detected at ~/.age/key.txt');
  const answer = await askQuestion('Do you want to generate a new Age keypair?');

  if (!answer) {
    console.log('⚠ Skipping key generation. You will need to create ~/.age/key.txt manually before pulling/decrypting.');
    return;
  }

  try {
    // Create ~/.age directory if it doesn't exist
    if (!fs.existsSync(keyDir)) {
      fs.mkdirSync(keyDir, { recursive: true });
    }

    // Generate age keypair using age-keygen
    execSync(`age-keygen -o "${keyPath}"`);
    console.log(`✓ Generated private key at ${keyPath}`);

    // Extract public key
    const pubKeyOutput = execSync(`age-keygen -y "${keyPath}"`, { encoding: 'utf-8' }).trim();
    console.log(`\nYour Public Key: ${pubKeyOutput}`);

    // Append to .agerecipients
    let recipientsContent = fs.existsSync(recipientsPath) ? fs.readFileSync(recipientsPath, 'utf-8') : '';

    if (!recipientsContent.includes(pubKeyOutput)) {
      fs.appendFileSync(recipientsPath, `\n# Added automatically during setup\n${pubKeyOutput}\n`);
      console.log('✓ Added public key to project .agerecipients file.');
    }
  } catch (err) {
    console.error('✕ Key generation failed. Ensure "age" CLI is installed globally (e.g., brew install age).');
  }
}

async function setup() {
  try {
    const { gitHooksDir, rootDir } = getDirectories();

    configureGitHooks(gitHooksDir);
    const recipientsPath = configureGitAgeScripts(rootDir);
  
    await generateAgeKeyPair(recipientsPath);
  } catch (err) {
    // Gracefully handle non-git directory execution during packaging
    console.log('git-env-share: Not inside a Git repository. Skipping setup.');
  }
}

setup().catch(err => {
  console.error('✕ Setup failed:', err);
});
