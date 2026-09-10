#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { askBooleanQuestion } from '../utils/askQuestion';
import { loadGitEnvShareConfig } from '../config';
import { listRootEnvFiles, writeFileAtomic } from '../utils/files';
import { getGitRoot } from '../utils/git';
import { readRecipientsFileContent, resolveRecipientsPath } from '../utils/recipientsFile';
import { addGitHubUser } from '../utils/sshEnvEncryption';

function readPublicKeyFromStdIn(query: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(query, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function runAddKeyAndReencrypt(argv = process.argv.slice(2)) {
  try {
    const rootDir = getGitRoot();
    const config = loadGitEnvShareConfig(rootDir);
    const recipientsPath = resolveRecipientsPath(rootDir, config);

    let pubKey = argv[0];
    const isSshMode = config.encryptionKey === 'ssh';

    if (!pubKey) {
      if (isSshMode) {
        pubKey = await readPublicKeyFromStdIn('Enter the SSH public key to authorize for this repo (ssh-..., ecdsa-..., or sk-...):\n');
      } else {
        pubKey = await readPublicKeyFromStdIn("Enter the new member's age public key (age1...):\n");
      }
    }

    if (isSshMode && !pubKey.startsWith('ssh-') && !pubKey.startsWith('ecdsa-') && !pubKey.startsWith('sk-')) {
      const addedKeys = await addGitHubUser(pubKey, { recipientsPath });
      if (addedKeys && addedKeys.length > 0) {
        console.log(`✓ Added ${addedKeys.length} GitHub SSH key(s) for @${pubKey} to ${recipientsPath}`);
      }
      return;
    }

    if (!isSshMode && !pubKey.startsWith('age1')) {
      console.error('✕ Invalid public key format. Age public keys must start with "age1".');
      process.exit(1);
    }

    if (isSshMode && !/^ssh-|^ecdsa-|^sk-/.test(pubKey)) {
      console.error('✕ Invalid SSH recipient format. Expected a raw SSH public key (ssh-..., ecdsa-..., or sk-...).');
      process.exit(1);
    }

    const recipientsContent = readRecipientsFileContent(recipientsPath);
    const hasRecipientAlready = recipientsContent.includes(pubKey);

    if (hasRecipientAlready) {
      console.log('𝑖 Public key is already present in .agerecipients.');
    }

    const recipientsWithNewKey = hasRecipientAlready
      ? recipientsContent
      : `${recipientsContent}\n# Added on ${new Date().toISOString().split('T')[0]}\n${pubKey}\n`;

    const tempRecipientsPath = hasRecipientAlready
      ? null
      : `${recipientsPath}.tmp-${process.pid}-${Date.now()}`;

    if (tempRecipientsPath) {
      fs.writeFileSync(tempRecipientsPath, recipientsWithNewKey, 'utf-8');
    }

    const recipientsPathForEncryption = tempRecipientsPath || recipientsPath;

    const envFiles = listRootEnvFiles(rootDir);
    const fileCount = envFiles.length;

    try {
      if (fileCount === 0) {
        if (!hasRecipientAlready) {
          writeFileAtomic(recipientsPath, recipientsWithNewKey);
          console.log('✓ Added key to .agerecipients file.');
          spawnSync('git', ['add', recipientsPath], { stdio: 'inherit' });
        }
        console.log('No .env files were found to re-encrypt. Only .agerecipients was updated.');
        return;
      }

      console.log(`\nThis will re-encrypt ${fileCount} environment file(s) and stage the updated .secret files.`);
      const shouldProceed = await askBooleanQuestion('Do you want to continue with the re-encryption?');
      if (!shouldProceed) {
        console.log('Re-encryption cancelled. No files were rewritten.');
        return;
      }

      const encryptedOutputs: Array<{ relativeEnvPath: string; secretFilePath: string; secretFileName: string; output: Buffer }> = [];

      for (const relativeEnvPath of envFiles) {
        const fullPath = path.join(rootDir, relativeEnvPath);
        if (!fs.existsSync(fullPath)) {
          continue;
        }

        const dir = path.dirname(fullPath);
        const baseName = path.basename(fullPath);
        const secretFileName = `.secret${baseName}`;
        const secretFilePath = path.join(dir, secretFileName);

        const plainData = fs.readFileSync(fullPath);
        const ageProcess = spawnSync('age', ['-R', recipientsPathForEncryption, '-e'], {
          input: plainData,
          maxBuffer: 1024 * 1024 * 50
        });

        if (ageProcess.status !== 0) {
          console.error(`✕ Re-encryption failed for ${relativeEnvPath}:`, ageProcess.stderr?.toString());
          process.exit(1);
        }

        encryptedOutputs.push({
          relativeEnvPath,
          secretFilePath,
          secretFileName,
          output: ageProcess.stdout
        });
      }

      for (const item of encryptedOutputs) {
        writeFileAtomic(item.secretFilePath, item.output);
        spawnSync('git', ['add', item.secretFilePath], { stdio: 'inherit' });
        console.log(`✓ Re-encrypted & staged: ${item.secretFileName}`);
      }

      if (!hasRecipientAlready) {
        writeFileAtomic(recipientsPath, recipientsWithNewKey);
        console.log('✓ Added key to .agerecipients file.');
      }

      spawnSync('git', ['add', recipientsPath], { stdio: 'inherit' });

      console.log(`\n✓ Successfully re-encrypted ${encryptedOutputs.length} secret file(s) and staged .agerecipients!`);
      console.log('> Run "git commit -m "security: add new team member key"" to complete onboarding.');
    } finally {
      if (tempRecipientsPath && fs.existsSync(tempRecipientsPath)) {
        fs.unlinkSync(tempRecipientsPath);
      }
    }
  } catch (error: any) {
    console.error('✕ Error executing add-key:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  void runAddKeyAndReencrypt();
}
