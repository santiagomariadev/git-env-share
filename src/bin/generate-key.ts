#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { askBooleanQuestion } from '../utils/askQuestion';
import { ensureSecureDirectory, ensureSecureFile } from '../utils/files';

function ensureSecureKeyLocation(keyDir: string, keyPath: string) {
  ensureSecureDirectory(keyDir);
  ensureSecureFile(keyPath);
}

async function generateKey() {
  const keyDir = path.join(os.homedir(), '.age');
  const keyPath = path.join(keyDir, 'key.txt');

  try {
    ensureSecureKeyLocation(keyDir, keyPath);

    if (!fs.existsSync(keyPath)) {
      const answer = await askBooleanQuestion('No Age private key was found in ~/.age/key.txt. Generate one now?');
      if (!answer) {
        console.log('Key generation cancelled.');
        return;
      }

      spawnSync('age-keygen', ['-o', keyPath], { stdio: 'ignore' });
      fs.chmodSync(keyPath, 0o600);
      console.log(`✓ Generated private key at: ${keyPath}`);
    } else {
      console.warn(`𝑖 Existing keypair found at: ${keyPath}`);
    }

    const publicKey = spawnSync('age-keygen', ['-y', keyPath], { encoding: 'utf-8' }).stdout.trim();

    console.log('\n======================================================');
    console.log('🔑 PUBLIC KEY (Share this with your repository admin):');
    console.log(`\n${publicKey}\n`);
    console.log('======================================================\n');

    try {
      if (process.platform === 'darwin') {
        spawnSync('sh', ['-c', `printf '%s' "${publicKey}" | pbcopy`], { stdio: 'ignore' });
        console.log('📋 Public key copied to clipboard!');
      } else if (process.platform === 'linux') {
        spawnSync('sh', ['-c', `printf '%s' "${publicKey}" | xclip -selection clipboard 2>/dev/null || printf '%s' "${publicKey}" | xsel -b 2>/dev/null`], { stdio: 'ignore' });
        console.log('📋 Public key copied to clipboard!');
      } else if (process.platform === 'win32') {
        spawnSync('cmd', ['/c', `echo ${publicKey}| clip`], { stdio: 'ignore' });
        console.log('📋 Public key copied to clipboard!');
      }
    } catch {
      // Ignore clipboard errors if utilities like xclip are not installed
    }
  } catch {
    console.error('✕ Failed to generate age keypair. Make sure "age" CLI is installed.');
    process.exit(1);
  }
}

export async function runGenerateKey() {
  await generateKey();
}

if (require.main === module) {
  void runGenerateKey();
}
