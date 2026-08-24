import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadGitEnvShareConfig, resolvePrivateKeyPath } from '../config';

export function getSshHostFromRemote(): string {
  try {
    const remoteUrl = execSync('git config --get remote.origin.url', { encoding: 'utf-8' }).trim();

    if (remoteUrl.startsWith('ssh://')) {
      const url = new URL(remoteUrl);
      return url.hostname;
    }

    const scpMatch = remoteUrl.match(/^[^@]+@([^:]+):/);
    if (scpMatch && scpMatch[1]) {
      return scpMatch[1];
    }

    return 'github.com';
  } catch {
    return 'github.com';
  }
}

export function resolveSshKeyPath(projectRoot = process.cwd()): string | null {
  const config = loadGitEnvShareConfig(projectRoot);
  const keyPath = resolvePrivateKeyPath({ ...config, mode: 'ssh' }, projectRoot);

  if (keyPath && fs.existsSync(keyPath)) {
    return keyPath;
  }

  const host = getSshHostFromRemote();

  try {
    const sshOutput = execSync(`ssh -G "${host}" 2>/dev/null`, { encoding: 'utf-8' });
    const lines = sshOutput.split('\n');

    for (const line of lines) {
      if (line.toLowerCase().startsWith('identityfile ')) {
        let rawPath = line.substring(13).trim();

        if (rawPath.startsWith('~')) {
          rawPath = path.join(os.homedir(), rawPath.slice(1));
        }

        if (fs.existsSync(rawPath)) {
          return rawPath;
        }
      }
    }
  } catch {
    // SSH command failed or missing host configuration
  }

  const defaults = [
    path.join(os.homedir(), '.ssh', 'id_ed25519'),
    path.join(os.homedir(), '.ssh', 'id_rsa'),
    path.join(os.homedir(), '.ssh', 'id_ecdsa'),
    path.join(os.homedir(), '.ssh', 'id_25519')
  ];

  return defaults.find((p) => fs.existsSync(p)) || null;
}

export function addGitHubUser(username: string, options: { recipientsPath?: string } = {}): Promise<string[]> {
  const recipientsPath = options.recipientsPath || path.join(process.cwd(), '.agerecipients');
  const normalizedUsername = String(username || '').trim();

  if (!normalizedUsername) {
    throw new Error('GitHub username is required.');
  }

  return new Promise((resolve, reject) => {
    const url = `https://github.com/${normalizedUsername}.keys`;

    const request = require('node:https').get(url, (res: any) => {
      let data = '';
      res.on('data', (chunk: Buffer | string) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200 || !data.trim()) {
          reject(new Error(`No SSH keys found for GitHub user "${normalizedUsername}".`));
          return;
        }

        const keys = data.trim().split(/\r?\n/).filter(Boolean);
        if (!keys.length) {
          reject(new Error(`No SSH keys found for GitHub user "${normalizedUsername}".`));
          return;
        }

        const existingContent = fs.existsSync(recipientsPath) ? fs.readFileSync(recipientsPath, 'utf-8') : '';
        const appended = keys.filter((key) => !existingContent.includes(key));

        if (appended.length > 0) {
          fs.appendFileSync(recipientsPath, `\n# GitHub: ${normalizedUsername}\n${appended.join('\n')}\n`);
        }

        resolve(appended);
      });
    });

    request.on('error', (err: Error) => {
      reject(err);
    });
  });
}

const username = process.argv[2];
if (username) {
  void addGitHubUser(username);
}
