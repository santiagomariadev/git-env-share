#!/usr/bin/env node

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

function readPublicKeyFromStdIn(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function addKeyAndReencrypt() {
  try {
    const rootDir = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
    const recipientsPath = path.join(rootDir, '.agerecipients');

    // Get Public Key from argument or prompt
    let pubKey = process.argv[2];
    if (!pubKey) {
      pubKey = await readPublicKeyFromStdIn('Enter the new member\'s public key (age1...):\n');
    }

    if (!pubKey.startsWith('age1')) {
      console.error('✕ Invalid public key format. Age public keys must start with "age1".');
      process.exit(1);
    }

    // Read existing .agerecipients or create one
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

    // Re-encrypt all local target files using the updated recipient list
    const envFiles = execSync('ls .env* 2>/dev/null || true', { encoding: 'utf-8' }).split('\n').filter(Boolean);
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
          console.error(`✕ Re-encryption failed for ${relativeEnvPath}:`, ageProcess.stderr.toString());
          process.exit(1);
        }

        fs.writeFileSync(secretFilePath, ageProcess.stdout);
        execSync(`git add "${secretFilePath}"`);
        console.log(`✓ Re-encrypted & staged: .secret${baseName}`);
        count++;
      }
    }

    // Stage .agerecipients file
    execSync(`git add "${recipientsPath}"`);

    console.log(`\n✓ Successfully re-encrypted ${count} secret file(s) and staged .agerecipients!`);
    console.log('> Run "git commit -m \"security: add new team member age key\"" to complete onboarding.');

  } catch (err) {
    console.error('✕ Error executing add-key:', err.message);
    process.exit(1);
  }
}

addKeyAndReencrypt();
