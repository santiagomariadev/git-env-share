#!/usr/bin/env node

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function getRemoteGitUrl() {
  const remoteUrl = execSync('git config --get remote.origin.url || echo ""', { encoding: 'utf-8' }).trim();
  return remoteUrl.length > 0 ? remoteUrl : null;
}

function verifyGitAccess() {
  // Get the remote URL of the Git repository
  const remoteUrl = getRemoteGitUrl();

  if (!remoteUrl) {
    console.error('✕ Git Access Denied: No remote URL found for the repository.');
    process.exit(1);
  }

  // Non-interactive SSH authentication check
  const sshCheck = spawnSync('ssh', [
    '-T',
    '-o',
    'BatchMode=yes',
    remoteUrl.replace(/^(git@|https:\/\/)/, '').replace(/:.*/, '')
  ], { encoding: 'utf-8' });
  const sshOutput = (sshCheck.stdout || '') + (sshCheck.stderr || '');

  // If the SSH check fails, exit with an error
  // Ref: https://docs.github.com/es/enterprise-cloud@latest/authentication/connecting-to-github-with-ssh/testing-your-ssh-connection
  if (!sshOutput.includes("You've successfully authenticated")) {
    console.error('✕ Git Access Denied: Cannot authenticate against repository remote.');
    process.exit(1);
  }
}

function validateAgeRecipients(rootDir) {
  const recipientsPath = path.join(rootDir, '.agerecipients');

  if (!fs.existsSync(recipientsPath)) {
    console.error('✕ Error: Missing .agerecipients file in repository root.');
    process.exit(1);
  }

  return recipientsPath;
}

function getEnvFilesAndUpdateGitIgnore() {
  // Check if .env files are missing on .gitignore and add them if necessary
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

  execSync(`git reset "${envFiles.join('" "')}" 2>/dev/null || true`);
  execSync(`git add "${gitIgnorePath}"`);

  return envFiles;
}

function secureEnvFile(rootDir, envFilePath, recipientsPath) {
  const fullPath = path.join(rootDir, envFilePath);

  if (fs.existsSync(fullPath)) {
    const dir = path.dirname(fullPath);
    const baseName = path.basename(fullPath);

    const secretFileName = `.secret${baseName}`;
    const secretFilePath = path.join(dir, secretFileName);
    const relativeSecretPath = path.relative(rootDir, secretFilePath);

    // Generate .secret prefixed file if it doesn't exist
    if (!fs.existsSync(secretFilePath)) {
      fs.writeFileSync(secretFilePath, '');
      console.log(`✓ Generated placeholder: ${relativeSecretPath}`);
    }

    // Encrypt original content into the .secret prefixed file using age
    const envContent = fs.readFileSync(fullPath);
    const ageProcess = spawnSync('age', ['-R', recipientsPath, '-e'], {
      input: envContent,
      maxBuffer: 1024 * 1024 * 50 // 50MB limit
    });

    if (ageProcess.status !== 0) {
      console.error(`✕ Encryption failed for ${envFilePath}:`, ageProcess.stderr.toString());
      process.exit(1);
    }

    // Write encrypted content to secret file
    fs.writeFileSync(secretFilePath, ageProcess.stdout);

    // Unstage the raw .env file if it was staged by accident
    try {
      execSync(`git restore --staged "${envFilePath}" 2>/dev/null`);
      console.log(`✓ Unstaged raw file: ${envFilePath}`);
    } catch (e) {
      // File wasn't staged; ignore error
    }

    // Stage the encrypted secret file and updated .gitignore
    execSync(`git add "${relativeSecretPath}" ".gitignore"`);
    console.log(`✓ Encrypted & Staged: ${relativeSecretPath}`);
  }
}

function runPreCommit() {
  try {
    const rootDir = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
    const gitRemoteUrl = getRemoteGitUrl();

    if(!gitRemoteUrl) {
      console.log('⚠ No remote URL found. Fallback to checking for .env files and updating .gitignore only.');
      getEnvFilesAndUpdateGitIgnore();
      return;
    }

    verifyGitAccess();
    const recipientsPath = validateAgeRecipients(rootDir);
    const envFiles = getEnvFilesAndUpdateGitIgnore();

    // Also scan for any unencrypted files in root or subdirectories if needed
    for (const relativePath of envFiles) {
      secureEnvFile(rootDir, relativePath, recipientsPath);
    }

    process.exit(0);
  } catch (error) {
    console.error('✕ pre-commit hook error:', error.message);
    process.exit(1);
  }
}

runPreCommit();
