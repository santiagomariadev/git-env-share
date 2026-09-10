import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ENCRYPTION_TRIGGERS } from '../config/defaults';
import { loadGitEnvShareConfig } from '../config';
import { listRootEnvFiles } from './files';
import { execGit, getGitRoot, gitAdd, gitResetPaths, gitRestoreStaged } from './git';

export type EnvMigrationSafetyState = {
  trackedRawEnvFiles: string[];
  stagedRawEnvFiles: string[];
  partiallyStagedRawEnvFiles: string[];
};

export function ensureManualMode(rootDir: string): void {
  const config = loadGitEnvShareConfig(rootDir);
  if (config.encryptionTrigger !== ENCRYPTION_TRIGGERS.MANUAL) {
    throw new Error('This command is only available when "encryptionTrigger" is set to "manual". Update your repo config and run setup again.');
  }
}

export function validateRecipients(rootDir: string): string {
  const config = loadGitEnvShareConfig(rootDir);
  const recipientsPath = path.join(rootDir, config.recipientsFile || '.agerecipients');

  if (!fs.existsSync(recipientsPath)) {
    fs.writeFileSync(recipientsPath, '# Add age or SSH public keys (one per line)\n');
    console.log('✓ Created recipients file for the configured encryption key:', config.encryptionKey);
  }

  return recipientsPath;
}

export function getEnvFilesAndUpdateGitIgnore(rootDir = process.cwd()): string[] {
  const gitIgnorePath = '.gitignore';

  if (!fs.existsSync(gitIgnorePath)) {
    fs.writeFileSync(gitIgnorePath, '');
    console.log('✓ Created .gitignore file.');
  }

  const envFiles = listRootEnvFiles(rootDir);

  let gitIgnoreContent = fs.readFileSync(gitIgnorePath, 'utf-8');
  let updated = false;

  if (!gitIgnoreContent.includes('# Missing .env files, added by git-env-share for security')) {
    gitIgnoreContent += '\n# Missing .env files, added by git-env-share for security';
  }

  envFiles.forEach((file) => {
    if (!gitIgnoreContent.match(new RegExp(`^${file}$`, 'm'))) {
      gitIgnoreContent += `\n${file}`;
      updated = true;
    }
  });

  if (updated) {
    fs.writeFileSync(gitIgnorePath, gitIgnoreContent);
    console.log('✓ Updated .gitignore with missing .env files.');
  }

  gitResetPaths(envFiles);
  gitAdd(gitIgnorePath);

  return envFiles;
}

function parseGitPathList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isRawEnvPath(filePath: string): boolean {
  return filePath.startsWith('.env');
}

function isSecretEnvPath(filePath: string): boolean {
  return filePath.startsWith('.secret.env');
}

function collectRawEnvFiles(paths: string[]): string[] {
  return paths
    .filter((item) => isRawEnvPath(item) && !isSecretEnvPath(item))
    .sort((left, right) => left.localeCompare(right));
}

export function getEnvMigrationSafetyState(rootDir = getGitRoot()): EnvMigrationSafetyState {
  const stagedPaths = collectRawEnvFiles(parseGitPathList(execGit(['diff', '--cached', '--name-only'])));
  const trackedPaths = collectRawEnvFiles(parseGitPathList(execGit(['ls-files'])));
  const changedPaths = new Set(collectRawEnvFiles(parseGitPathList(execGit(['diff', '--name-only']))));
  const partiallyStagedPaths = stagedPaths.filter((file) => changedPaths.has(file));

  return {
    trackedRawEnvFiles: trackedPaths,
    stagedRawEnvFiles: stagedPaths,
    partiallyStagedRawEnvFiles: partiallyStagedPaths
  };
}

export function warnAboutUnsafeRawEnvGitState(rootDir = getGitRoot()): EnvMigrationSafetyState {
  const state = getEnvMigrationSafetyState(rootDir);

  if (state.trackedRawEnvFiles.length > 0) {
    console.log('⚠ Safety warning: raw .env files are tracked in Git.');
    console.log(`  Tracked raw files: ${state.trackedRawEnvFiles.join(', ')}`);
    console.log('  Recommendation: remove these files from the index (git rm --cached <file>) and keep only .secret.* files tracked.');
  }

  if (state.stagedRawEnvFiles.length > 0) {
    console.log('⚠ Safety warning: raw .env files are currently staged.');
    console.log(`  Staged raw files: ${state.stagedRawEnvFiles.join(', ')}`);
    console.log('  Recommendation: run "git restore --staged <file>" before committing.');
  }

  if (state.partiallyStagedRawEnvFiles.length > 0) {
    console.log('⚠ Safety warning: raw .env files are partially staged (staged + unstaged changes).');
    console.log(`  Partially staged raw files: ${state.partiallyStagedRawEnvFiles.join(', ')}`);
    console.log('  Recommendation: unstage raw files and use "npx ges stage" or commit-mode hooks to regenerate encrypted outputs from the latest content.');
  }

  return state;
}

export function secureEnvFile(rootDir: string, envFilePath: string, recipientsPath: string): void {
  const fullPath = path.join(rootDir, envFilePath);

  if (!fs.existsSync(fullPath)) {
    return;
  }

  const dir = path.dirname(fullPath);
  const baseName = path.basename(fullPath);

  const secretFileName = `.secret${baseName}`;
  const secretFilePath = path.join(dir, secretFileName);
  const relativeSecretPath = path.relative(rootDir, secretFilePath);

  if (!fs.existsSync(secretFilePath)) {
    fs.writeFileSync(secretFilePath, '');
    console.log(`✓ Generated placeholder: ${relativeSecretPath}`);
  }

  const envContent = fs.readFileSync(fullPath);
  const ageProcess = spawnSync('age', ['-R', recipientsPath, '-e'], {
    input: envContent,
    maxBuffer: 1024 * 1024 * 50
  });

  if (ageProcess.status !== 0) {
    console.error(`✕ Encryption failed for ${envFilePath}:`, ageProcess.stderr?.toString());
    process.exit(1);
  }

  fs.writeFileSync(secretFilePath, ageProcess.stdout);
  gitRestoreStaged(envFilePath);
  console.log(`✓ Unstaged raw file: ${envFilePath}`);
  gitAdd(relativeSecretPath, '.gitignore');
  console.log(`✓ Encrypted & Staged: ${relativeSecretPath}`);
}

export function stageEnvSecrets(rootDir = getGitRoot()): { envFiles: string[]; encryptedCount: number; recipientsPath: string } {
  process.chdir(rootDir);

  warnAboutUnsafeRawEnvGitState(rootDir);

  const recipientsPath = validateRecipients(rootDir);
  const envFiles = getEnvFilesAndUpdateGitIgnore(rootDir);

  let encryptedCount = 0;
  for (const relativePath of envFiles) {
    secureEnvFile(rootDir, relativePath, recipientsPath);
    encryptedCount++;
  }

  return { envFiles, encryptedCount, recipientsPath };
}
