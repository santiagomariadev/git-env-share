#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ENCRYPTION_KEYS, ENCRYPTION_TRIGGERS, type GitEnvShareConfig } from '../config/defaults';
import { hasExplicitConfig, loadGitEnvShareConfig } from '../config';
import { setup } from '../scripts/setup';
import { askBooleanQuestion, askQuestion } from '../utils/askQuestion';

export interface InitOptions {
  encryptionKey: GitEnvShareConfig['encryptionKey'];
  encryptionTrigger: GitEnvShareConfig['encryptionTrigger'];
  dryRun: boolean;
}

export function parseInitOptions(argv: string[] = process.argv.slice(2)): InitOptions {
  const args = new Map<string, string>();
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const nextValue = argv[index + 1];

    if (value === '--key' || value === '-k') {
      if (nextValue && !nextValue.startsWith('-')) {
        args.set('key', nextValue);
        index += 1;
      }
      continue;
    }

    if (value === '--trigger' || value === '-t') {
      if (nextValue && !nextValue.startsWith('-')) {
        args.set('trigger', nextValue);
        index += 1;
      }
      continue;
    }

    if (value === '--dry-run' || value === '-n') {
      dryRun = true;
      continue;
    }

    if (value.startsWith('--key=')) {
      args.set('key', value.slice('--key='.length));
      continue;
    }

    if (value.startsWith('--trigger=')) {
      args.set('trigger', value.slice('--trigger='.length));
      continue;
    }

    if (value.startsWith('--dry-run=')) {
      dryRun = value.slice('--dry-run='.length).toLowerCase() !== 'false';
      continue;
    }

    if (value === '--help' || value === '-h') {
      args.set('help', '1');
    }
  }

  const keyValue = args.get('key')?.toLowerCase();
  const triggerValue = args.get('trigger')?.toLowerCase();

  const encryptionKey =
    keyValue === ENCRYPTION_KEYS.SSH ? ENCRYPTION_KEYS.SSH : ENCRYPTION_KEYS.AGE;
  const encryptionTrigger =
    triggerValue === ENCRYPTION_TRIGGERS.MANUAL
      ? ENCRYPTION_TRIGGERS.MANUAL
      : ENCRYPTION_TRIGGERS.COMMIT;

  return {
    encryptionKey,
    encryptionTrigger,
    dryRun,
  };
}

function printInitHelp(): void {
  console.log('git-env-share init');
  console.log('');
  console.log('Options:');
  console.log('  --key, -k     Authentication method: age or ssh (default: age)');
  console.log('  --trigger, -t Encryption trigger: commit or manual (default: commit)');
  console.log('  --dry-run, -n Preview repository changes without writing files');
  console.log('  --help, -h    Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  npx ges init --key ssh --trigger manual');
  console.log('  npx ges init --trigger commit');
}

async function promptForConfig(argv: string[]): Promise<void> {
  const repoRoot = process.cwd();
  const configPath = path.join(repoRoot, '.git-env-share.config');

  if (hasExplicitConfig(repoRoot)) {
    return;
  }

  const parsedOptions = parseInitOptions(argv);
  const hasFlagHelp =
    argv.includes('--help') || argv.includes('-h') || argv.some((arg) => arg.startsWith('--help='));
  const hasKeyFlag =
    argv.includes('--key') || argv.includes('-k') || argv.some((arg) => arg.startsWith('--key='));
  const hasTriggerFlag =
    argv.includes('--trigger') ||
    argv.includes('-t') ||
    argv.some((arg) => arg.startsWith('--trigger='));
  const hasDryRunFlag = parsedOptions.dryRun;

  if (hasFlagHelp) {
    printInitHelp();
    return;
  }

  if (hasDryRunFlag) {
    console.log(
      'Preview mode: npx ges init would create the repo config and then run setup, but no repository files will be modified.',
    );
    return;
  }

  const answer = await askBooleanQuestion(
    'No git-env-share config was found. Would you like to create one now?',
  );
  if (!answer) {
    console.log(
      'Skipping config creation. You can run "npx ges init" later or add the repo config manually.',
    );
    return;
  }

  const encryptionKey = hasKeyFlag
    ? parsedOptions.encryptionKey
    : (await askBooleanQuestion('Use SSH as the encryption key instead of age?'))
      ? ENCRYPTION_KEYS.SSH
      : ENCRYPTION_KEYS.AGE;

  const encryptionTrigger = hasTriggerFlag
    ? parsedOptions.encryptionTrigger
    : (await askBooleanQuestion('Use manual encryption instead of commit-time encryption?'))
      ? ENCRYPTION_TRIGGERS.MANUAL
      : ENCRYPTION_TRIGGERS.COMMIT;

  const config: GitEnvShareConfig = {
    encryptionKey,
    encryptionTrigger,
  };

  console.log(`
Selected setup: ${config.encryptionKey === ENCRYPTION_KEYS.SSH ? 'SSH' : 'Age'} key + ${config.encryptionTrigger === ENCRYPTION_TRIGGERS.MANUAL ? 'manual' : 'commit-time'} trigger.
`);

  if (encryptionKey === ENCRYPTION_KEYS.AGE) {
    const ageKeyPath = await askQuestion('ageKeyPath (default: ~/.age/key.txt):');
    config.ageKeyPath = ageKeyPath && ageKeyPath.trim() !== '' ? ageKeyPath : '~/.age/key.txt';
    console.log(
      'Age is selected as the encryption key. If you leave the path blank, a new keypair will be generated automatically.',
    );
  } else {
    const sshKeyPath = await askQuestion('sshKeyPath (default: ~/.ssh/id_ed25519):');
    config.sshKeyPath = sshKeyPath && sshKeyPath.trim() !== '' ? sshKeyPath : '~/.ssh/id_ed25519';

    const addGitHubUsernames = await askBooleanQuestion('Add GitHub usernames for SSH recipients?');
    if (addGitHubUsernames) {
      const usernameInput = await askQuestion('Enter GitHub usernames, separated by commas:');

      const usernames = usernameInput
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

      if (usernames.length > 0) {
        config.githubUsernames = usernames;
      }
    }
  }

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  console.log(`✓ Wrote repo config to ${configPath}`);
}

export async function runInit(argv = process.argv.slice(2)) {
  const parsedOptions = parseInitOptions(argv);
  const hasHelp =
    argv.includes('--help') || argv.includes('-h') || argv.some((arg) => arg.startsWith('--help='));

  if (hasHelp) {
    printInitHelp();
    return;
  }

  if (!parsedOptions.dryRun) {
    await promptForConfig(argv);
  }

  const config = loadGitEnvShareConfig(process.cwd());
  if (
    config.encryptionKey === ENCRYPTION_KEYS.SSH &&
    (!config.githubUsernames || config.githubUsernames.length === 0)
  ) {
    console.log(
      'SSH was selected as the encryption key without GitHub usernames. You can add them later to .git-env-share.config or package.json.',
    );
  }
  await setup(argv);
}

if (require.main === module) {
  void runInit();
}
