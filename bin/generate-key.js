#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function generateKey() {
  const keyDir = path.join(os.homedir(), '.age');
  const keyPath = path.join(keyDir, 'key.txt');

  try {
    // Ensure ~/.age directory exists
    if (!fs.existsSync(keyDir)) {
      fs.mkdirSync(keyDir, { recursive: true });
    }

    if (!fs.existsSync(keyPath)) {
      execSync(`age-keygen -o "${keyPath}" 2>/dev/null`);
      console.log(`✓ Generated private key at: ${keyPath}`);
    } else {
      console.warn(`𝑖 Existing keypair found at: ${keyPath}`);
    }

    // Extract public key
    const publicKey = execSync(`age-keygen -y "${keyPath}"`, { encoding: 'utf-8' }).trim();

    console.log('\n======================================================');
    console.log('🔑 PUBLIC KEY (Share this with your repository admin):');
    console.log(`\n${publicKey}\n`);
    console.log('======================================================\n');

    // Copy to clipboard
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
