#!/usr/bin/env node
import { runInit } from './init';
import { runReconfigure } from './reconfigure';
import { runStageEnv } from './stage-env';
import { runPushEnv } from './push-env';
import { runGenerateKey } from './generate-key';
import { runAddKeyAndReencrypt } from './add-key';
import { runAddSshKey } from './add-ssh-key';
import { runAddGitHubUser } from './add-github-user';
import { runPreCommit } from './pre-commit';
import { runSmudge } from './smudge';

function printHelp() {
  console.log('ges - git env share');
  console.log('');
  console.log('Usage:');
  console.log('  npx ges <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  init                  Initialize and configure the repository');
  console.log('  reconfigure           Re-apply git filter and hook setup');
  console.log('  stage                 Encrypt and stage .secret.env* files (manual mode)');
  console.log('  push                  Encrypt, stage, and commit .secret.env* files (manual mode)');
  console.log('  generate-key          Generate an age keypair and print public key');
  console.log('  add-key <key|user>    Add age key, SSH key, or GitHub username and optionally re-encrypt');
  console.log('  add-ssh-key <key>     Add a raw SSH public key recipient');
  console.log('  add-github-user <u>   Fetch and add SSH keys for a GitHub username');
  console.log('');
  console.log('Internal commands:');
  console.log('  precommit             Run pre-commit encryption hook logic');
  console.log('  smudge <path>         Decrypt file content from Git smudge filter');
}

async function main() {
  const [subcommand, ...args] = process.argv.slice(2);

  if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printHelp();
    return;
  }

  switch (subcommand) {
    case 'init':
      await runInit();
      return;
    case 'reconfigure':
      await runReconfigure();
      return;
    case 'stage':
    case 'stage-env':
      runStageEnv();
      return;
    case 'push':
    case 'push-env':
      runPushEnv(args);
      return;
    case 'generate-key':
    case 'keygen':
      await runGenerateKey();
      return;
    case 'add-key':
      await runAddKeyAndReencrypt(args);
      return;
    case 'add-ssh-key':
      await runAddSshKey(args);
      return;
    case 'add-github-user':
      await runAddGitHubUser(args);
      return;
    case 'precommit':
      runPreCommit();
      return;
    case 'smudge':
      runSmudge(args);
      return;
    default:
      console.error(`Unknown command: ${subcommand}`);
      console.error('Run "npx ges help" to see available commands.');
      process.exit(1);
  }
}

void main();