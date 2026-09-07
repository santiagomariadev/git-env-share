#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { loadGitEnvShareConfig } from '../config';
import { addGitHubUser } from '../utils/sshEnvEncryption';

export async function runAddGitHubUser(argv = process.argv.slice(2)) {
  const rootDir = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).stdout.trim();
  const config = loadGitEnvShareConfig(rootDir);
  const recipientsPath = path.join(rootDir, config.recipientsFile || '.agerecipients');
  const username = argv[0];

  if (!username) {
    console.error('Usage: npx ges add-github-user <github-username>');
    process.exit(1);
  }

  try {
    const added = await addGitHubUser(username, { recipientsPath });
    if (added.length === 0) {
      console.log(`ℹ No new GitHub SSH keys were added for @${username}.`);
      return;
    }

    console.log(`✓ Added ${added.length} GitHub SSH key(s) for @${username} to ${recipientsPath}`);
  } catch (error: any) {
    console.error(`✕ ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  void runAddGitHubUser();
}
