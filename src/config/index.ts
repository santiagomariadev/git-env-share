import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DEFAULT_CONFIG,
  ENCRYPTION_KEYS,
  ENCRYPTION_TRIGGERS,
  VALID_ENCRYPTION_KEYS,
  VALID_ENCRYPTION_TRIGGERS,
  VALID_MODES,
  type GitEnvShareConfig
} from './defaults';
import { readJsonFile, resolveConfigPath } from '../utils/files';

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function resolveEncryptionKey(rawEncryptionKey?: unknown, fallback: 'age' | 'ssh' = DEFAULT_CONFIG.encryptionKey): 'age' | 'ssh' {
  const normalizedKey = typeof rawEncryptionKey === 'string' ? rawEncryptionKey.toLowerCase() : undefined;

  if (normalizedKey && VALID_ENCRYPTION_KEYS.includes(normalizedKey as (typeof VALID_ENCRYPTION_KEYS)[number])) {
    return normalizedKey as 'age' | 'ssh';
  }

  return fallback;
}

export function hasExplicitConfig(projectRoot = process.cwd()): boolean {
  const rootDir = projectRoot || process.cwd();
  const packageJsonPath = path.join(rootDir, 'package.json');
  const configFilePath = path.join(rootDir, '.git-env-share.config');

  if (!fs.existsSync(packageJsonPath) && !fs.existsSync(configFilePath)) {
    return false;
  }

  if (fs.existsSync(packageJsonPath)) {
    const pkg = readJsonFile(packageJsonPath) || {};
    const packageConfig = pkg['git-env-share'] || pkg.gitEnvShare || {};
    if (packageConfig && typeof packageConfig === 'object' && Object.keys(packageConfig).length > 0) {
      return true;
    }
  }

  if (fs.existsSync(configFilePath)) {
    const fileConfig = readJsonFile(configFilePath) || {};
    if (fileConfig && typeof fileConfig === 'object' && Object.keys(fileConfig).length > 0) {
      return true;
    }
  }

  return false;
}

export function loadGitEnvShareConfig(projectRoot = process.cwd(), overrides: Partial<GitEnvShareConfig> = {}): GitEnvShareConfig {
  const rootDir = projectRoot || process.cwd();
  const packageJsonPath = path.join(rootDir, 'package.json');
  const configFilePath = path.join(rootDir, '.git-env-share.config');

  const config: GitEnvShareConfig = {};

  if (fs.existsSync(packageJsonPath)) {
    const pkg = readJsonFile(packageJsonPath) || {};
    const packageConfig = pkg['git-env-share'] || pkg.gitEnvShare || {};
    if (packageConfig && typeof packageConfig === 'object') {
      Object.assign(config, packageConfig);
    }
  }

  if (fs.existsSync(configFilePath)) {
    const fileConfig = readJsonFile(configFilePath) || {};
    if (fileConfig && typeof fileConfig === 'object') {
      Object.assign(config, fileConfig);
    }
  }

  if (overrides && typeof overrides === 'object') {
    Object.assign(config, overrides);
  }

  const encryptionKey = resolveEncryptionKey(config.encryptionKey, DEFAULT_CONFIG.encryptionKey);
  config.encryptionKey = encryptionKey;

  config.ageKeyPath = config.ageKeyPath || DEFAULT_CONFIG.ageKeyPath;
  config.sshKeyPath = config.sshKeyPath || DEFAULT_CONFIG.sshKeyPath;
  config.githubUsernames = normalizeArray(config.githubUsernames || config.githubUsers || config.githubUser || []);
  config.recipientsFile = config.recipientsFile || DEFAULT_CONFIG.recipientsFile;
  config.enabled = config.enabled !== false;
  config.paused = Boolean(config.paused);
  const rawTrigger = String(config.encryptionTrigger || DEFAULT_CONFIG.encryptionTrigger).toLowerCase();
  config.encryptionTrigger = VALID_ENCRYPTION_TRIGGERS.includes(rawTrigger as (typeof VALID_ENCRYPTION_TRIGGERS)[number])
    ? rawTrigger
    : DEFAULT_CONFIG.encryptionTrigger;

  return config;
}

export function describeGitEnvShareConfig(config: Partial<GitEnvShareConfig> = {}): string {
  const resolved = loadGitEnvShareConfig(process.cwd(), config);
  const encryptionLabel = resolved.encryptionKey === ENCRYPTION_KEYS.SSH ? 'SSH' : 'Age';
  const triggerLabel = resolved.encryptionTrigger === ENCRYPTION_TRIGGERS.MANUAL ? 'manual' : 'commit';

  if (triggerLabel === ENCRYPTION_TRIGGERS.MANUAL) {
    return `${encryptionLabel} encryption is configured for manual workflow. Use "npx git-env-share-stage-env" to encrypt and stage files, or "npx git-env-share-push-env" to encrypt, stage, and commit in one step.`;
  }

  return `${encryptionLabel} encryption is configured for commit-time workflow. The pre-commit hook will encrypt .env files before each commit.`;
}

export function resolvePrivateKeyPath(config: Partial<GitEnvShareConfig> = {}, projectRoot = process.cwd()): string | null {
  const effectiveConfig = loadGitEnvShareConfig(projectRoot);
  const mergedConfig = { ...effectiveConfig, ...config };
  const encryptionKey = resolveEncryptionKey(
    mergedConfig.encryptionKey ?? config.encryptionKey,
    effectiveConfig.encryptionKey as 'age' | 'ssh'
  );

  const candidate = encryptionKey === ENCRYPTION_KEYS.SSH
    ? mergedConfig.sshKeyPath || DEFAULT_CONFIG.sshKeyPath
    : mergedConfig.ageKeyPath || DEFAULT_CONFIG.ageKeyPath;

  const candidatePath = resolveConfigPath(candidate, projectRoot);
  if (candidatePath && fs.existsSync(candidatePath)) {
    return candidatePath;
  }

  const fallbackPaths: string[] = [];
  if (encryptionKey === ENCRYPTION_KEYS.SSH) {
    fallbackPaths.push(
      path.join(os.homedir(), '.ssh', 'id_ed25519'),
      path.join(os.homedir(), '.ssh', 'id_rsa'),
      path.join(os.homedir(), '.ssh', 'id_ecdsa'),
      path.join(os.homedir(), '.ssh', 'id_25519')
    );
  } else {
    fallbackPaths.push(
      path.join(os.homedir(), '.age', 'key.txt'),
      path.join(os.homedir(), '.config', 'age', 'keys.txt')
    );
  }

  const found = fallbackPaths.find((item) => fs.existsSync(item));
  if (found) return found;

  return candidatePath || fallbackPaths[0] || null;
}

export {
  DEFAULT_CONFIG,
  ENCRYPTION_KEYS,
  ENCRYPTION_TRIGGERS,
  VALID_ENCRYPTION_KEYS,
  VALID_ENCRYPTION_TRIGGERS,
  VALID_MODES
};
