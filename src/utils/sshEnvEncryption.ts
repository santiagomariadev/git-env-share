import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadGitEnvShareConfig, resolvePrivateKeyPath } from '../config';
import { readRecipientsFileContent, resolveRecipientsPath } from './recipientsFile';
import { splitTrimmedNonEmptyLines } from './text';

export function isSshPublicKey(value: string | undefined | null): boolean {
  const normalized = String(value || '').trim();
  if (!normalized) return false;

  return /^(ssh-(rsa|ed25519|dss)|ecdsa-[A-Za-z0-9-]+|sk-(ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com)/.test(normalized);
}

export function addSshRecipient(publicKey: string, options: { recipientsPath?: string } = {}): string[] {
  const normalizedKey = String(publicKey || '').trim();

  if (!normalizedKey) {
    throw new Error('SSH public key is required.');
  }

  if (!isSshPublicKey(normalizedKey)) {
    throw new Error('Invalid SSH public key format. Expected ssh-..., ecdsa-..., or sk-... recipient.');
  }

  const recipientsPath = options.recipientsPath || path.join(process.cwd(), '.agerecipients');
  const existingContent = readRecipientsFileContent(recipientsPath);

  if (existingContent.includes(normalizedKey)) {
    return [];
  }

  fs.appendFileSync(recipientsPath, `\n# Added on ${new Date().toISOString().split('T')[0]}\n${normalizedKey}\n`);
  return [normalizedKey];
}

export function getSshHostFromRemote(): string {
  try {
    const remoteOutput = spawnSync('git', ['config', '--get', 'remote.origin.url'], { encoding: 'utf-8' });
    const remoteUrl = (remoteOutput.stdout || '').trim();

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
  const keyPath = resolvePrivateKeyPath({ ...config, encryptionKey: 'ssh' }, projectRoot);

  if (keyPath && fs.existsSync(keyPath)) {
    return keyPath;
  }

  const host = getSshHostFromRemote();

  try {
    const sshOutput = spawnSync('ssh', ['-G', host], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    const lines = (sshOutput.stdout || '').split('\n');

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

function getGitHubKeysUrl(username: string, baseUrl?: string): string {
  const normalizedBaseUrl = (baseUrl || 'https://github.com').replace(/\/$/, '');
  return `${normalizedBaseUrl}/${encodeURIComponent(username)}.keys`;
}

export function fetchGitHubPublicKeys(username: string, options: { baseUrl?: string } = {}): Promise<string[]> {
  const normalizedUsername = String(username || '').trim();

  if (!normalizedUsername) {
    throw new Error('GitHub username is required.');
  }

  return new Promise((resolve, reject) => {
    const url = getGitHubKeysUrl(normalizedUsername, options.baseUrl);
    const transport = url.startsWith('http://') ? require('node:http') : require('node:https');

    const request = transport.get(url, (res: any) => {
      let data = '';
      res.on('data', (chunk: Buffer | string) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200 || !data.trim()) {
          reject(new Error(`No SSH keys found for GitHub user "${normalizedUsername}".`));
          return;
        }

        const keys = splitTrimmedNonEmptyLines(data);
        if (!keys.length) {
          reject(new Error(`No SSH keys found for GitHub user "${normalizedUsername}".`));
          return;
        }

        resolve(keys);
      });
    });

    request.on('error', (err: Error) => {
      reject(err);
    });
  });
}

export async function syncGitHubRecipientsFromConfig(projectRoot = process.cwd(), options: { baseUrl?: string } = {}): Promise<string[]> {
  const config = loadGitEnvShareConfig(projectRoot);
  const recipientsPath = resolveRecipientsPath(projectRoot, config);
  const usernames = Array.isArray(config.githubUsernames) ? config.githubUsernames : [];
  const allKeys: string[] = [];

  for (const username of usernames) {
    const keys = await fetchGitHubPublicKeys(username, options);
    for (const key of keys) {
      if (!allKeys.includes(key)) {
        allKeys.push(key);
      }
    }
  }

  const generatedContent = allKeys.length > 0
    ? `# Auto-generated by git-env-share for SSH mode\n${allKeys.join('\n')}\n`
    : '# Auto-generated by git-env-share for SSH mode\n';

  fs.writeFileSync(recipientsPath, generatedContent, { encoding: 'utf-8' });
  return allKeys;
}

export async function addGitHubUser(username: string, options: { recipientsPath?: string; baseUrl?: string } = {}): Promise<string[]> {
  const recipientsPath = options.recipientsPath || path.join(process.cwd(), '.agerecipients');
  const normalizedUsername = String(username || '').trim();

  if (!normalizedUsername) {
    throw new Error('GitHub username is required.');
  }

  const keys = await fetchGitHubPublicKeys(normalizedUsername, { baseUrl: options.baseUrl });
  const existingContent = readRecipientsFileContent(recipientsPath);
  const appended = keys.filter((key) => !existingContent.includes(key));

  if (appended.length > 0) {
    fs.appendFileSync(recipientsPath, `\n# GitHub: ${normalizedUsername}\n${appended.join('\n')}\n`);
  }

  return appended;
}
