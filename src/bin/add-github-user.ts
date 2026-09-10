#!/usr/bin/env node
import { loadGitEnvShareConfig } from '../config';
import { getGitRoot } from '../utils/git';
import { resolveRecipientsPath } from '../utils/recipientsFile';
import { addGitHubUser } from '../utils/sshEnvEncryption';

export async function runAddGitHubUser(argv = process.argv.slice(2)) {
  const rootDir = getGitRoot();
  const config = loadGitEnvShareConfig(rootDir);
  const recipientsPath = resolveRecipientsPath(rootDir, config);
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
