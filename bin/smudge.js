#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { loadGitEnvShareConfig, resolvePrivateKeyPath } = require('../config');

function runSmudge() {
  const secretFilePath = process.argv[2]; // Passed via %f
  const projectRoot = process.cwd();
  const config = loadGitEnvShareConfig(projectRoot);
  const keyPath = resolvePrivateKeyPath(config, projectRoot);

  if (!fs.existsSync(keyPath)) {
    console.error(`✕ Private key missing at ${keyPath}`);
    console.error(`Update your ${config.mode === 'ssh' ? 'SSH' : 'age'} key setting in the project config or run the matching key-generation command.`);
    process.exit(1);
  }

  // Decrypt incoming stream from Git
  const ageProcess = spawnSync('age', ['-d', '-i', keyPath], {
    input: fs.readFileSync(0),
    maxBuffer: 1024 * 1024 * 50
  });

  if (ageProcess.status !== 0) {
    console.error('✕ Decryption failed.');
    const guidanceMessage = config.mode === 'ssh'
      ? 'Ensure your SSH private key matches the GitHub public key authorized for this repository.'
      : 'Run "npx git-env-share-generate-key" to generate your age keypair and share the public key with your repository admin.';
    console.error(guidanceMessage);
    process.exit(1);
  }

  const decryptedContent = ageProcess.stdout;

  // Compare decrypted incoming content with existing plain local file
  if (secretFilePath) {
    const dir = path.dirname(secretFilePath);
    const envFileName = path.basename(secretFilePath).replace(/^\.secret/, '');
    const envFilePath = path.join(dir, envFileName);

    if (fs.existsSync(envFilePath)) {
      const envContent = fs.readFileSync(envFilePath);

      if (!envContent.equals(decryptedContent)) {
        console.warn(`\n⚠ DISCREPANCY DETECTED in ${envFilePath}!`);
        console.warn(`Incoming remote changes differ from your local ${envFileName}.`);
        // Get diff between git ignored local file and incoming decrypted content
        const diffProcess = spawnSync('diff', ['-u', envFilePath, '-'], {
          input: decryptedContent,
          maxBuffer: 1024 * 1024 * 50
        });

        if (diffProcess.status === 0) {
          console.log('No differences found.');
        } else {
          // Update local file with conflict markers for user to resolve
          const conflictContent = Buffer.concat([
            Buffer.from(`<<<<<<< LOCAL VERSION\n`),
            envContent,
            Buffer.from(`=======\n`),
            decryptedContent,
            Buffer.from(`>>>>>>> REMOTE VERSION\n`)
          ]);
          fs.writeFileSync(envFilePath, conflictContent);
          console.warn(`Conflict markers added to ${envFilePath}. Please resolve manually.\n`);
        }
      }
    } else {
      // If clone, automatically create the local unencrypted file
      fs.writeFileSync(envFilePath, decryptedContent);
      console.log(`✓ Restored local unencrypted file: ${envFilePath}`);
    }
  }

  // Output ciphertext or placeholder to Git working tree for .secret prefixed file
  process.stdout.write(ageProcess.stdout);
}

runSmudge();
