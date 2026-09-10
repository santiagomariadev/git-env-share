#!/usr/bin/env node
import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { askBooleanQuestion } from '../utils/askQuestion';
import { loadGitEnvShareConfig } from '../config';
import { listRootEnvFiles } from '../utils/files';
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
    const rootDir = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).stdout.trim();
    const config = loadGitEnvShareConfig(rootDir);
    const recipientsPath = path.join(rootDir, config.recipientsFile || '.agerecipients');

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

    const recipientsContent = fs.existsSync(recipientsPath)
      ? fs.readFileSync(recipientsPath, 'utf-8')
      : '';

    if (recipientsContent.includes(pubKey)) {
      console.log('𝑖 Public key is already present in .agerecipients.');
    } else {
      const formattedEntry = `\n# Added on ${new Date().toISOString().split('T')[0]}\n${pubKey}\n`;
      fs.appendFileSync(recipientsPath, formattedEntry);
      console.log('✓ Added key to .agerecipients file.');
    }

    const envFiles = listRootEnvFiles(rootDir);
    const fileCount = envFiles.length;

    if (fileCount === 0) {
      console.log('No .env files were found to re-encrypt. Only .agerecipients was updated.');
      spawnSync('git', ['add', recipientsPath], { stdio: 'inherit' });
      return;
    }

    console.log(`\nThis will re-encrypt ${fileCount} environment file(s) and stage the updated .secret files.`);
    const shouldProceed = await askBooleanQuestion('Do you want to continue with the re-encryption?');
    if (!shouldProceed) {
      console.log('Re-encryption cancelled. The new key was added to .agerecipients, but no files were rewritten.');
      return;
    }

    let count = 0;

    for (const relativeEnvPath of envFiles) {
      const fullPath = path.join(rootDir, relativeEnvPath);

      if (fs.existsSync(fullPath)) {
        const dir = path.dirname(fullPath);
        const baseName = path.basename(fullPath);
        const secretFilePath = path.join(dir, `.secret${baseName}`);

        const plainData = fs.readFileSync(fullPath);
        const ageProcess = spawnSync('age', ['-R', recipientsPath, '-e'], {
          input: plainData,
          maxBuffer: 1024 * 1024 * 50
        });

        if (ageProcess.status !== 0) {
          console.error(`✕ Re-encryption failed for ${relativeEnvPath}:`, ageProcess.stderr?.toString());
          process.exit(1);
        }

        fs.writeFileSync(secretFilePath, ageProcess.stdout);
        spawnSync('git', ['add', secretFilePath], { stdio: 'inherit' });
        console.log(`✓ Re-encrypted & staged: .secret${baseName}`);
        count++;
      }
    }

    spawnSync('git', ['add', recipientsPath], { stdio: 'inherit' });

    console.log(`\n✓ Successfully re-encrypted ${count} secret file(s) and staged .agerecipients!`);
    console.log('> Run "git commit -m "security: add new team member key"" to complete onboarding.');
  } catch (error: any) {
    console.error('✕ Error executing add-key:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  void runAddKeyAndReencrypt();
}
