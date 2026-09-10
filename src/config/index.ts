import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEFAULT_CONFIG, VALID_MODES, type GitEnvShareConfig } from './defaults';
import { readJsonFile, resolveConfigPath } from '../utils/files';

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function resolveEncryptionKey(rawEncryptionKey?: unknown, fallback: 'age' | 'ssh' = DEFAULT_CONFIG.encryptionKey): 'age' | 'ssh' {
  const normalizedKey = typeof rawEncryptionKey === 'string' ? rawEncryptionKey.toLowerCase() : undefined;

  if (normalizedKey && VALID_MODES.includes(normalizedKey as (typeof VALID_MODES)[number])) {
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
  config.encryptionTrigger = rawTrigger === 'manual' || rawTrigger === 'commit'
    ? rawTrigger
    : DEFAULT_CONFIG.encryptionTrigger;

  return config;
}

export function resolvePrivateKeyPath(config: Partial<GitEnvShareConfig> = {}, projectRoot = process.cwd()): string | null {
  const effectiveConfig = loadGitEnvShareConfig(projectRoot);
  const mergedConfig = { ...effectiveConfig, ...config };
  const encryptionKey = resolveEncryptionKey(
    mergedConfig.encryptionKey ?? config.encryptionKey,
    effectiveConfig.encryptionKey as 'age' | 'ssh'
  );

  const candidate = encryptionKey === 'ssh'
    ? mergedConfig.sshKeyPath || DEFAULT_CONFIG.sshKeyPath
    : mergedConfig.ageKeyPath || DEFAULT_CONFIG.ageKeyPath;

  const candidatePath = resolveConfigPath(candidate, projectRoot);
  if (candidatePath && fs.existsSync(candidatePath)) {
    return candidatePath;
  }

  const fallbackPaths: string[] = [];
  if (encryptionKey === 'ssh') {
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

export { DEFAULT_CONFIG, VALID_MODES };
