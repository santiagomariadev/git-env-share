#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadGitEnvShareConfig, resolvePrivateKeyPath } from '../config';
import { writeFileAtomic } from '../utils/files';

function getGitRootOrNull(projectRoot: string): string | null {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: projectRoot,
    encoding: 'utf-8'
  });

  if (result.status !== 0) {
    return null;
  }

  const root = (result.stdout || '').trim();
  return root || null;
}

function isMergeLikeOperationInProgress(projectRoot: string): boolean {
  const gitDirResult = spawnSync('git', ['rev-parse', '--git-dir'], {
    cwd: projectRoot,
    encoding: 'utf-8'
  });

  if (gitDirResult.status !== 0) {
    return false;
  }

  const gitDir = (gitDirResult.stdout || '').trim();
  if (!gitDir) {
    return false;
  }

  const resolvedGitDir = path.isAbsolute(gitDir) ? gitDir : path.join(projectRoot, gitDir);

  return fs.existsSync(path.join(resolvedGitDir, 'MERGE_HEAD'))
    || fs.existsSync(path.join(resolvedGitDir, 'REBASE_HEAD'))
    || fs.existsSync(path.join(resolvedGitDir, 'CHERRY_PICK_HEAD'));
}

function toGitRelativePath(projectRoot: string, filePath: string): string {
  return path.relative(projectRoot, path.resolve(filePath)).split(path.sep).join('/');
}

function isPathTracked(projectRoot: string, relativePath: string): boolean {
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', relativePath], {
    cwd: projectRoot,
    encoding: 'utf-8'
  });

  return tracked.status === 0;
}

function writeBlob(projectRoot: string, content: Buffer): string | null {
  const result = spawnSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: projectRoot,
    input: content,
    encoding: 'utf-8'
  });

  if (result.status !== 0) {
    return null;
  }

  const sha = (result.stdout || '').trim();
  return sha || null;
}

export function tryMarkTrackedPathAsConflict(
  projectRoot: string,
  filePath: string,
  localContent: Buffer,
  remoteContent: Buffer
): boolean {
  const gitRoot = getGitRootOrNull(projectRoot);
  if (!gitRoot || !isMergeLikeOperationInProgress(gitRoot)) {
    return false;
  }

  const candidatePath = path.isAbsolute(filePath) ? filePath : path.join(gitRoot, filePath);
  const relativePath = toGitRelativePath(gitRoot, candidatePath);
  if (!isPathTracked(gitRoot, relativePath)) {
    return false;
  }

  const baseSha = writeBlob(gitRoot, localContent);
  const localSha = writeBlob(gitRoot, localContent);
  const remoteSha = writeBlob(gitRoot, remoteContent);

  if (!baseSha || !localSha || !remoteSha) {
    return false;
  }

  const indexInfo = [
    `100644 ${baseSha} 1\t${relativePath}`,
    `100644 ${localSha} 2\t${relativePath}`,
    `100644 ${remoteSha} 3\t${relativePath}`,
    ''
  ].join('\n');

  const update = spawnSync('git', ['update-index', '--index-info'], {
    cwd: gitRoot,
    input: indexInfo,
    encoding: 'utf-8'
  });

  return update.status === 0;
}

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

  const decryptedContent = ageProcess.stdout as Buffer;
  let outputContent: Buffer = decryptedContent;

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
          outputContent = conflictContent;

          const markedAsConflict = tryMarkTrackedPathAsConflict(projectRoot, envFilePath, envContent, decryptedContent);
          if (markedAsConflict) {
            console.warn('Git index conflict state was updated for this file.');
          }

          console.warn(`Conflict markers added to ${envFilePath}. Please resolve manually.\n`);
        }
      }
    } else {
      writeFileAtomic(envFilePath, decryptedContent);
      console.log(`✓ Restored local unencrypted file: ${envFilePath}`);
    }
  }

  process.stdout.write(outputContent);
}

if (require.main === module) {
  runSmudge();
}
