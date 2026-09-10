import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function readJsonFile(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function resolveHomeRelativePath(value: string | undefined): string | undefined {
  if (!value || typeof value !== 'string') return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function resolveConfigPath(value: string | undefined, projectRoot = process.cwd()): string | null {
  if (!value || typeof value !== 'string') return null;

  const normalized = resolveHomeRelativePath(value);
  if (normalized && path.isAbsolute(normalized)) return normalized;

  return path.resolve(projectRoot, normalized ?? value);
}

export function ensureSecureDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  fs.chmodSync(dirPath, 0o700);
}

export function ensureSecureFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.chmodSync(filePath, 0o600);
  }
}

export function listRootEnvFiles(projectRoot = process.cwd()): string[] {
  const entries = fs.readdirSync(projectRoot, { withFileTypes: true });

  return entries
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.startsWith('.env'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}
