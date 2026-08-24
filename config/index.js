const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULT_CONFIG, VALID_MODES } = require('./defaults');
const { readJsonFile, resolveConfigPath } = require('../utils/files');

function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean);
  return [];
}

function loadGitEnvShareConfig(projectRoot = process.cwd()) {
  const rootDir = projectRoot || process.cwd();
  const packageJsonPath = path.join(rootDir, 'package.json');
  const configFilePath = path.join(rootDir, '.git-env-share.config');

  const config = { ...DEFAULT_CONFIG };

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

  config.mode = String(config.mode || DEFAULT_CONFIG.mode).toLowerCase();
  if (!VALID_MODES.includes(config.mode)) {
    config.mode = DEFAULT_CONFIG.mode;
  }

  config.ageKeyPath = config.ageKeyPath || DEFAULT_CONFIG.ageKeyPath;
  config.sshKeyPath = config.sshKeyPath || DEFAULT_CONFIG.sshKeyPath;
  config.githubUsernames = normalizeArray(config.githubUsernames || config.githubUsers || config.githubUser || []);
  config.recipientsFile = config.recipientsFile || DEFAULT_CONFIG.recipientsFile;

  return config;
}

function resolvePrivateKeyPath(config = {}, projectRoot = process.cwd()) {
  const effectiveConfig = loadGitEnvShareConfig(projectRoot);
  const mergedConfig = { ...effectiveConfig, ...config };
  const mode = String(mergedConfig.mode || DEFAULT_CONFIG.mode).toLowerCase();

  const candidate = mode === 'ssh'
    ? mergedConfig.sshKeyPath || DEFAULT_CONFIG.sshKeyPath
    : mergedConfig.ageKeyPath || DEFAULT_CONFIG.ageKeyPath;

  const candidatePath = resolveConfigPath(candidate, projectRoot);
  if (candidatePath && fs.existsSync(candidatePath)) {
    return candidatePath;
  }

  const fallbackPaths = [];
  if (mode === 'ssh') {
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

  const found = fallbackPaths.find(item => fs.existsSync(item));
  if (found) return found;

  return candidatePath || fallbackPaths[0] || null;
}

module.exports = {
  DEFAULT_CONFIG,
  loadGitEnvShareConfig,
  resolvePrivateKeyPath
};
