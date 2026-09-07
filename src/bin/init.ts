#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { hasExplicitConfig, loadGitEnvShareConfig } from '../config';
import { setup } from '../scripts/setup';
import { askBooleanQuestion, askQuestion } from '../utils/askQuestion';
import { GitEnvShareConfig } from '../config/defaults';

async function promptForConfig(): Promise<void> {
  const repoRoot = process.cwd();
  const configPath = path.join(repoRoot, '.git-env-share.config');

  if (hasExplicitConfig(repoRoot)) {
    return;
  }

  const answer = await askBooleanQuestion('No git-env-share config was found. Would you like to create one now?');
  if (!answer) {
    console.log('Skipping config creation. You can run git-env-share-init later or add the repo config manually.');
    return;
  }

  const modeAnswer = await askBooleanQuestion('Use SSH mode instead of age mode?');
  const mode = modeAnswer ? 'ssh' : 'age';
  const encryptionTriggerAnswer = await askBooleanQuestion('Use commit-time encryption instead of stage-time encryption?');
  const config: GitEnvShareConfig = {
    mode,
    encryptionTrigger: encryptionTriggerAnswer ? 'commit' : 'stage'
  };

  if (mode === 'age') {
    const ageKeyPath = await askQuestion('ageKeyPath (default: ~/.age/key.txt):');
    config.ageKeyPath = ageKeyPath && ageKeyPath.trim() !== '' ? ageKeyPath : '~/.age/key.txt';
    console.log('Age mode selected. If you leave the path blank, a new keypair will be generated automatically.');
  } else {
    const sshKeyPath = await askQuestion('sshKeyPath (default: ~/.ssh/id_ed25519):');
    config.sshKeyPath = sshKeyPath && sshKeyPath.trim() !== '' ? sshKeyPath : '~/.ssh/id_ed25519';

    const addGitHubUsernames = await askBooleanQuestion('Add GitHub usernames for SSH recipients?');
    if (addGitHubUsernames) {
      const usernameInput = await askQuestion('Enter GitHub usernames, separated by commas:');

      const usernames = usernameInput
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

      if (usernames.length > 0) {
        config.githubUsernames = usernames;
      }
    }
  }

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  console.log(`✓ Wrote repo config to ${configPath}`);
}

async function main() {
  await promptForConfig();
  const config = loadGitEnvShareConfig(process.cwd());
  if (config.mode === 'ssh' && (!config.githubUsernames || config.githubUsernames.length === 0)) {
    console.log('SSH mode selected without GitHub usernames. You can add them later to .git-env-share.config or package.json.');
  }
  await setup();
}

void main();
