#!/usr/bin/env node
import { loadGitEnvShareConfig } from '../config';
import { getGitRoot } from '../utils/git';
import { resolveRecipientsPath } from '../utils/recipientsFile';
import { addSshRecipient } from '../utils/sshEnvEncryption';

export async function runAddSshKey(argv = process.argv.slice(2)) {
  const rootDir = getGitRoot();
  const config = loadGitEnvShareConfig(rootDir);
  const recipientsPath = resolveRecipientsPath(rootDir, config);
  const rawKey = argv[0];

  if (!rawKey) {
    console.error('Usage: npx ges add-ssh-key "ssh-ed25519 AAAA..."');
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

if (require.main === module) {
  void runAddSshKey();
}
