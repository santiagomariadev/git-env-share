import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadGitEnvShareConfig } from '../config';
import { getGitRoot, gitAdd, gitResetPaths, gitRestoreStaged } from './git';

export function ensureManualMode(rootDir: string): void {
  const config = loadGitEnvShareConfig(rootDir);
  if (config.encryptionTrigger !== 'manual') {
    throw new Error('This command is only available in manual mode. Update "encryptionTrigger" to "manual" in your repo config, then run setup again.');
  }
}

export function validateRecipients(rootDir: string): string {
  const config = loadGitEnvShareConfig(rootDir);
  const recipientsPath = path.join(rootDir, config.recipientsFile || '.agerecipients');

  if (!fs.existsSync(recipientsPath)) {
    fs.writeFileSync(recipientsPath, '# Add age or SSH public keys (one per line)\n');
    console.log('✓ Created recipients file for the configured mode:', config.mode);
  }

  return recipientsPath;
}

export function getEnvFilesAndUpdateGitIgnore(): string[] {
  const gitIgnorePath = '.gitignore';

  if (!fs.existsSync(gitIgnorePath)) {
    fs.writeFileSync(gitIgnorePath, '');
    console.log('✓ Created .gitignore file.');
  }

  const ls = spawnSync('sh', ['-c', 'ls .env* 2>/dev/null || true'], { encoding: 'utf-8' });
  const envFiles = (ls.stdout || '').split('\n').filter(Boolean);

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

  const recipientsPath = validateRecipients(rootDir);
  const envFiles = getEnvFilesAndUpdateGitIgnore();

  let encryptedCount = 0;
  for (const relativePath of envFiles) {
    secureEnvFile(rootDir, relativePath, recipientsPath);
    encryptedCount++;
  }

  return { envFiles, encryptedCount, recipientsPath };
}
