#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadGitEnvShareConfig } from '../config';
import { addSshRecipient } from '../utils/sshEnvEncryption';

async function main() {
  const rootDir = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).stdout.trim();
  const config = loadGitEnvShareConfig(rootDir);
  const recipientsPath = path.join(rootDir, config.recipientsFile || '.agerecipients');
  const rawKey = process.argv[2];

  if (!rawKey) {
    console.error('Usage: git-env-share-add-ssh-key "ssh-ed25519 AAAA..."');
    process.exit(1);
  }

  try {
    const added = addSshRecipient(rawKey, { recipientsPath });
    if (added.length === 0) {
      console.log('ℹ SSH public key is already present in .agerecipients.');
      return;
    }

    console.log(`✓ Added SSH public key to ${recipientsPath}`);
  } catch (error: any) {
    console.error(`✕ ${error.message}`);
    process.exit(1);
  }
}

void main();
