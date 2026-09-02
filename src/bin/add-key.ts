#!/usr/bin/env node
import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { askBooleanQuestion } from '../utils/askQuestion';
import { loadGitEnvShareConfig } from '../config';
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

async function addKeyAndReencrypt() {
  try {
    const rootDir = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
    const config = loadGitEnvShareConfig(rootDir);
    const recipientsPath = path.join(rootDir, config.recipientsFile || '.agerecipients');

    let pubKey = process.argv[2];
    const isSshMode = config.mode === 'ssh';

    if (!pubKey) {
      if (isSshMode) {
        pubKey = await readPublicKeyFromStdIn('Enter the GitHub username to authorize for this repo:\n');
      } else {
        pubKey = await readPublicKeyFromStdIn("Enter the new member's public key (age1...):\n");
      }
    }

    if (isSshMode) {
      if (pubKey.startsWith('ssh-') || pubKey.startsWith('age1')) {
        if (!pubKey.startsWith('age1') && !pubKey.startsWith('ssh-')) {
          console.error('✕ Invalid SSH recipient format. Expected a GitHub username, ssh-... recipient, or age1 key.');
          process.exit(1);
        }
      } else {
        const addedKeys = await addGitHubUser(pubKey, { recipientsPath });
        if (addedKeys && addedKeys.length > 0) {
          console.log(`✓ Added ${addedKeys.length} GitHub SSH key(s) for @${pubKey} to ${recipientsPath}`);
        }
        return;
      }
    } else if (!pubKey.startsWith('age1')) {
      console.error('✕ Invalid public key format. Age public keys must start with "age1".');
      process.exit(1);
    }

    let recipientsContent = fs.existsSync(recipientsPath)
      ? fs.readFileSync(recipientsPath, 'utf-8')
      : '';

    if (recipientsContent.includes(pubKey)) {
      console.log('𝑖 Public key is already present in .agerecipients.');
    } else {
      const formattedEntry = `\n# Added on ${new Date().toISOString().split('T')[0]}\n${pubKey}\n`;
      fs.appendFileSync(recipientsPath, formattedEntry);
      console.log('✓ Added key to .agerecipients file.');
    }

    const envFiles = execSync('ls .env* 2>/dev/null || true', { encoding: 'utf-8' }).split('\n').filter(Boolean);
    const fileCount = envFiles.length;

    if (fileCount === 0) {
      console.log('No .env files were found to re-encrypt. Only .agerecipients was updated.');
      execSync(`git add "${recipientsPath}"`);
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
        execSync(`git add "${secretFilePath}"`);
        console.log(`✓ Re-encrypted & staged: .secret${baseName}`);
        count++;
      }
    }

    execSync(`git add "${recipientsPath}"`);

    console.log(`\n✓ Successfully re-encrypted ${count} secret file(s) and staged .agerecipients!`);
    console.log('> Run "git commit -m "security: add new team member key"" to complete onboarding.');
  } catch (error: any) {
    console.error('✕ Error executing add-key:', error.message);
    process.exit(1);
  }
}

void addKeyAndReencrypt();
