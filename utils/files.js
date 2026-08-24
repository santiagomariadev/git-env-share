const fs = require('fs');
const os = require('os');
const path = require('path');

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_error) {
    return null;
  }
}

function resolveHomeRelativePath(value) {
  if (!value || typeof value !== 'string') return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function resolveConfigPath(value, projectRoot = process.cwd()) {
  if (!value || typeof value !== 'string') return null;

  const normalized = resolveHomeRelativePath(value);
  if (path.isAbsolute(normalized)) return normalized;

  return path.resolve(projectRoot, normalized);
}

function ensureSecureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  fs.chmodSync(dirPath, 0o700);
}

function ensureSecureFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.chmodSync(filePath, 0o600);
  }
}

module.exports = {
  ensureSecureDirectory,
  ensureSecureFile,
  readJsonFile,
  resolveConfigPath,
  resolveHomeRelativePath
};
