#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const askQuestion = require('../utils/askQuestion');
const { ensureSecureDirectory, ensureSecureFile } = require('../utils/files');

function ensureSecureKeyLocation(keyDir, keyPath) {
  ensureSecureDirectory(keyDir);
  ensureSecureFile(keyPath);
}

async function generateKey() {
  const keyDir = path.join(os.homedir(), '.age');
  const keyPath = path.join(keyDir, 'key.txt');

  try {
    ensureSecureKeyLocation(keyDir, keyPath);

    if (!fs.existsSync(keyPath)) {
      const answer = await askQuestion('No Age private key was found in ~/.age/key.txt. Generate one now?');
      if (!answer) {
        console.log('Key generation cancelled.');
        return;
      }

      execSync(`age-keygen -o "${keyPath}" 2>/dev/null`);
      fs.chmodSync(keyPath, 0o600);
      console.log(`✓ Generated private key at: ${keyPath}`);
    } else {
      console.warn(`𝑖 Existing keypair found at: ${keyPath}`);
    }

    const publicKey = execSync(`age-keygen -y "${keyPath}"`, { encoding: 'utf-8' }).trim();

    console.log('\n======================================================');
    console.log('🔑 PUBLIC KEY (Share this with your repository admin):');
    console.log(`\n${publicKey}\n`);
    console.log('======================================================\n');

    try {
      if (process.platform === 'darwin') {
        execSync(`echo "${publicKey}" | pbcopy`);
        console.log('📋 Public key copied to clipboard!');
      } else if (process.platform === 'linux') {
        execSync(`echo "${publicKey}" | xclip -selection clipboard 2>/dev/null || echo "${publicKey}" | xsel -b 2>/dev/null`);
        console.log('📋 Public key copied to clipboard!');
      } else if (process.platform === 'win32') {
        execSync(`echo ${publicKey}| clip`);
        console.log('📋 Public key copied to clipboard!');
      }
    } catch (clipErr) {
      // Ignore clipboard errors if utilities like xclip are not installed
    }
  } catch (err) {
    console.error('✕ Failed to generate age keypair. Make sure "age" CLI is installed.');
    process.exit(1);
  }
}

generateKey();
