#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadGitEnvShareConfig, resolvePrivateKeyPath } from '../config';
import { writeFileAtomic } from '../utils/files';

export function runSmudge(argv = process.argv.slice(2)) {
  const secretFilePath = argv[0];
  const projectRoot = process.cwd();
  const config = loadGitEnvShareConfig(projectRoot);
  const keyPath = resolvePrivateKeyPath(config, projectRoot);

  if (!keyPath || !fs.existsSync(keyPath)) {
    console.error('✕ Private key is missing or unreadable.');
    console.error(`Update your ${config.encryptionKey === 'ssh' ? 'SSH' : 'age'} key setting in the project config or run the matching key-generation command.`);
    process.exit(1);
  }

  const ageProcess = spawnSync('age', ['-d', '-i', keyPath], {
    input: fs.readFileSync(0),
    maxBuffer: 1024 * 1024 * 50
  });

  if (ageProcess.status !== 0) {
    console.error('✕ Decryption failed.');
    const guidanceMessage = config.encryptionKey === 'ssh'
      ? 'Ensure your SSH private key matches the GitHub public key authorized for this repository.'
      : 'Run "npx ges generate-key" to generate your age keypair and share the public key with your repository admin.';
    console.error(guidanceMessage);
    process.exit(1);
  }

  const decryptedContent = ageProcess.stdout;

  if (secretFilePath && secretFilePath.startsWith('.secret')) {
    const dir = path.dirname(secretFilePath);
    const envFileName = path.basename(secretFilePath).replace(/^\.secret/, '');
    const envFilePath = path.join(dir, envFileName);

    if (fs.existsSync(envFilePath)) {
      const envContent = fs.readFileSync(envFilePath);

      if (!envContent.equals(decryptedContent)) {
        console.warn(`\n⚠ DISCREPANCY DETECTED in ${envFilePath}!`);
        console.warn(`Incoming remote changes differ from your local ${envFileName}.`);
        const diffProcess = spawnSync('diff', ['-u', envFilePath, '-'], {
          input: decryptedContent,
          maxBuffer: 1024 * 1024 * 50
        });

        if (diffProcess.status === 0) {
          console.log('No differences found.');
        } else {
          const conflictContent = Buffer.concat([
            Buffer.from('<<<<<<< LOCAL VERSION\n'),
            envContent,
            Buffer.from('=======\n'),
            decryptedContent,
            Buffer.from('>>>>>>> REMOTE VERSION\n')
          ]);
          writeFileAtomic(envFilePath, conflictContent);
          console.warn(`Conflict markers added to ${envFilePath}. Please resolve manually.\n`);
        }
      }
    } else {
      writeFileAtomic(envFilePath, decryptedContent);
      console.log(`✓ Restored local unencrypted file: ${envFilePath}`);
    }
  }

  process.stdout.write(ageProcess.stdout);
}

if (require.main === module) {
  runSmudge();
}
