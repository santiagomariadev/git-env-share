const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const runIntegrationTests = process.env.GIT_ENV_SHARE_RUN_INTEGRATION === '1';
const integrationTest = runIntegrationTests ? test : test.skip;

// This E2E test mimics the real consumer workflow: pack the library, install it in a disposable repo,
// run setup, then exercise the new manual commands that prepare encrypted .secret files for commits.
function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    ...options,
    stdio: options.stdio ?? ['pipe', 'pipe', 'pipe']
  });

  if (result.error) {
    throw new Error(`${command} ${args.join(' ')} failed because it is unavailable in PATH. Install the required CLI first.\n${result.error.message}`);
  }

  if (result.status !== 0) {
    const errorOutput = result.stderr || result.stdout || '';
    throw new Error(`${command} ${args.join(' ')} failed:\n${errorOutput}`);
  }

  return result.stdout.trim();
}

function runCommandResult(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf-8',
    ...options,
    stdio: options.stdio ?? ['pipe', 'pipe', 'pipe']
  });
}

function writeRepoConfig(repoDir, config) {
  fs.writeFileSync(path.join(repoDir, '.git-env-share.config'), JSON.stringify(config, null, 2));
}

function runReconfigure(repoDir, env, input = 'y\n') {
  const result = spawnSync('script', ['-qec', 'npx ges reconfigure', '/dev/null'], {
    cwd: repoDir,
    env,
    input,
    encoding: 'utf-8'
  });

  if (result.status !== 0) {
    throw new Error(`ges reconfigure failed:\n${result.stderr || result.stdout || ''}`);
  }
}

function assertCommitContainsEncryptedSecrets(repoDir, env) {
  const latestChanged = runCommand('git', ['show', '--name-only', '--pretty=', 'HEAD'], { cwd: repoDir, env });
  const secretBlob = runCommand('git', ['show', ':./.secret.env'], { cwd: repoDir, env });

  assert.ok(latestChanged.includes('.secret.env'));
  assert.match(secretBlob, /^age-encryption\.org\/v1/m);
  assert.ok(!latestChanged.includes('.env\n'));
}

function createFakeSshBinary(tempRoot) {
  const fakeBinDir = path.join(tempRoot, 'fake-bin');
  fs.mkdirSync(fakeBinDir, { recursive: true });
  const fakeSshPath = path.join(fakeBinDir, 'ssh');

  fs.writeFileSync(fakeSshPath, '#!/usr/bin/env sh\necho "You\'ve successfully authenticated"\nexit 1\n');
  fs.chmodSync(fakeSshPath, 0o755);

  return fakeBinDir;
}

function bootstrapConsumerWorkspace(tempRoot, initialConfig, options = {}) {
  const projectRoot = path.resolve(__dirname, '..');
  const homeDir = path.join(tempRoot, 'home');
  const repoDir = path.join(tempRoot, 'repo');

  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(path.join(homeDir, '.age'), { recursive: true });
  fs.mkdirSync(path.join(homeDir, '.ssh'), { recursive: true });

  const baseEnv = {
    ...process.env,
    HOME: homeDir,
    XDG_CONFIG_HOME: path.join(homeDir, '.config'),
    GIT_CONFIG_GLOBAL: path.join(homeDir, '.gitconfig')
  };

  const fakeSshBin = options.useFakeSsh ? createFakeSshBinary(tempRoot) : null;
  const env = fakeSshBin
    ? { ...baseEnv, PATH: `${fakeSshBin}:${process.env.PATH || ''}` }
    : baseEnv;

  const tarballName = runCommand('npm', ['pack', '--pack-destination', tempRoot], { cwd: projectRoot, env });
  const tarballPath = path.join(tempRoot, tarballName.split(/\r?\n/).pop());

  const ageKeyPath = path.join(homeDir, '.age', 'key.txt');
  runCommand('age-keygen', ['-o', ageKeyPath], { env });
  const agePublicKey = runCommand('age-keygen', ['-y', ageKeyPath], { env });

  const sshKeyPath = path.join(homeDir, '.ssh', 'id_ed25519');
  runCommand('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', sshKeyPath], { env });
  const sshPublicKey = fs.readFileSync(`${sshKeyPath}.pub`, 'utf-8').trim();

  runCommand('git', ['init', '-b', 'main'], { cwd: repoDir, env });
  runCommand('git', ['config', 'user.name', 'Test User'], { cwd: repoDir, env });
  runCommand('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir, env });

  if (options.useFakeSsh) {
    runCommand('git', ['remote', 'add', 'origin', 'git@github.com:example/repo.git'], { cwd: repoDir, env });
  }

  fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({
    name: 'consumer-workspace',
    private: true,
    devDependencies: {
      'git-env-share': `file:${tarballPath}`
    }
  }, null, 2));

  writeRepoConfig(repoDir, initialConfig);
  fs.writeFileSync(path.join(repoDir, '.agerecipients'), `${agePublicKey}\n`);

  runCommand('npm', ['install'], { cwd: repoDir, env });

  return { repoDir, homeDir, env, agePublicKey, ageKeyPath, sshPublicKey, sshKeyPath };
}

integrationTest('installs the package and validates manual commands with mode guardrails', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ges-e2e-'));
  const homeDir = path.join(tempRoot, 'home');
  const repoDir = path.join(tempRoot, 'repo');

  // We isolate the consumer repo and HOME directory to avoid touching the developer machine.
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(path.join(homeDir, '.age'), { recursive: true });

  const env = {
    ...process.env,
    HOME: homeDir,
    XDG_CONFIG_HOME: path.join(homeDir, '.config'),
    GIT_CONFIG_GLOBAL: path.join(homeDir, '.gitconfig')
  };

  // Build a tarball from the current package so the consumer repo installs the exact package under test.
  const tarballName = runCommand('npm', ['pack', '--pack-destination', tempRoot], { cwd: projectRoot, env });
  const tarballPath = path.join(tempRoot, tarballName.split(/\r?\n/).pop());

  // This simulates a real team member generating an age keypair and publishing the public key.
  const ageKeyPath = path.join(homeDir, '.age', 'key.txt');
  runCommand('age-keygen', ['-o', ageKeyPath], { env });
  const publicKey = runCommand('age-keygen', ['-y', ageKeyPath], { env });

  runCommand('git', ['init', '-b', 'main'], { cwd: repoDir, env });
  runCommand('git', ['config', 'user.name', 'Test User'], { cwd: repoDir, env });
  runCommand('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir, env });

  // In the consumer repo, install the tarball using the file protocol so this is as close as possible
  // to a real end-user install without depending on an external registry.
  fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({
    name: 'consumer-workspace',
    private: true,
    devDependencies: {
      'git-env-share': `file:${tarballPath}`
    }
  }, null, 2));

  // This is the repo-level config. We keep commit mode explicit to validate the default UX.
  fs.writeFileSync(path.join(repoDir, '.git-env-share.config'), JSON.stringify({
    encryptionKey: 'age',
    ageKeyPath: '~/.age/key.txt',
    encryptionTrigger: 'commit'
  }, null, 2));

  // The repo must trust the generated public key so the filter can encrypt values for this member.
  fs.writeFileSync(path.join(repoDir, '.agerecipients'), `${publicKey}\n`);

  runCommand('npm', ['install'], { cwd: repoDir, env });

  // We call the package's actual reconfigure step to ensure the installed binary creates the Git filter
  // and repo settings exactly the way a user would see in practice.
  const setupResult = spawnSync('script', ['-qec', 'npx ges reconfigure', '/dev/null'], {
    cwd: repoDir,
    env,
    input: 'y\n',
    encoding: 'utf-8'
  });

  if (setupResult.status !== 0) {
    throw new Error(`ges reconfigure failed:\n${setupResult.stderr || setupResult.stdout || ''}`);
  }

  const envFilePath = path.join(repoDir, '.env');
  const devEnvFilePath = path.join(repoDir, '.env.development');
  const originalEnv = 'HELLO=world\n';
  const originalDevEnv = 'NODE_ENV=development\n';

  // Main workflow: developers edit local .env files, then explicitly stage encrypted outputs.
  fs.writeFileSync(envFilePath, originalEnv);
  fs.writeFileSync(devEnvFilePath, originalDevEnv);

  // In commit mode, manual commands must refuse execution and point users to manual mode.
  const stageInCommitMode = runCommandResult('npx', ['ges', 'stage'], { cwd: repoDir, env });
  const pushInCommitMode = runCommandResult('npx', ['ges', 'push', '-m', 'should not commit'], { cwd: repoDir, env });

  assert.notEqual(stageInCommitMode.status, 0);
  assert.notEqual(pushInCommitMode.status, 0);
  assert.match((stageInCommitMode.stderr || '') + (stageInCommitMode.stdout || ''), /only available.+manual/i);
  assert.match((pushInCommitMode.stderr || '') + (pushInCommitMode.stdout || ''), /only available.+manual/i);

  // Switch to manual mode and run setup again to apply the intended trigger strategy.
  fs.writeFileSync(path.join(repoDir, '.git-env-share.config'), JSON.stringify({
    encryptionKey: 'age',
    ageKeyPath: '~/.age/key.txt',
    encryptionTrigger: 'manual'
  }, null, 2));

  const manualSetupResult = spawnSync('script', ['-qec', 'npx ges reconfigure', '/dev/null'], {
    cwd: repoDir,
    env,
    input: 'y\n',
    encoding: 'utf-8'
  });

  if (manualSetupResult.status !== 0) {
    throw new Error(`ges reconfigure (manual) failed:\n${manualSetupResult.stderr || manualSetupResult.stdout || ''}`);
  }

  runCommand('npx', ['ges', 'stage'], { cwd: repoDir, env });

  const secretEnvPath = path.join(repoDir, '.secret.env');
  const secretDevEnvPath = path.join(repoDir, '.secret.env.development');

  assert.equal(fs.existsSync(secretEnvPath), true);
  assert.equal(fs.existsSync(secretDevEnvPath), true);

  // The staged repository artifacts must be encrypted .secret files, not raw .env plaintext.
  const stagedEnv = runCommand('git', ['show', ':./.secret.env'], { cwd: repoDir, env });
  const stagedDevEnv = runCommand('git', ['show', ':./.secret.env.development'], { cwd: repoDir, env });
  const stagedNames = runCommand('git', ['diff', '--cached', '--name-only'], { cwd: repoDir, env })
    .split(/\r?\n/)
    .filter(Boolean);

  assert.notEqual(stagedEnv, originalEnv);
  assert.notEqual(stagedDevEnv, originalDevEnv);
  assert.match(stagedEnv, /^age-encryption\.org\/v1/m);
  assert.match(stagedDevEnv, /^age-encryption\.org\/v1/m);
  assert.ok(stagedNames.includes('.secret.env'));
  assert.ok(stagedNames.includes('.secret.env.development'));
  assert.ok(!stagedNames.includes('.env'));
  assert.ok(!stagedNames.includes('.env.development'));

  // The repo configuration should target encrypted secret files.
  const attributes = fs.readFileSync(path.join(repoDir, '.gitattributes'), 'utf-8');
  assert.match(attributes, /\.secret\.env\*\s+filter=git-age/);

  // Manual commit path after stage-env.
  runCommand('git', ['commit', '-m', 'Add initial encrypted env files'], { cwd: repoDir, env });

  // push-env should re-encrypt/stage and commit in one command, with custom commit message support.
  fs.writeFileSync(envFilePath, 'HELLO=updated\n');
  runCommand('npx', ['ges', 'push', '-m', 'security: rotate env secrets'], { cwd: repoDir, env });

  const latestMessage = runCommand('git', ['log', '-1', '--pretty=%s'], { cwd: repoDir, env });
  const latestChanged = runCommand('git', ['show', '--name-only', '--pretty=', 'HEAD'], { cwd: repoDir, env });

  assert.equal(latestMessage, 'security: rotate env secrets');
  assert.ok(latestChanged.includes('.secret.env'));
  assert.equal(runCommand('git', ['ls-files', '.env'], { cwd: repoDir, env }), '');

  // Raw env files remain local working-tree files and are not tracked directly.
  assert.equal(fs.readFileSync(envFilePath, 'utf-8'), 'HELLO=updated\n');
  assert.equal(fs.readFileSync(devEnvFilePath, 'utf-8'), originalDevEnv);
});

integrationTest('migration path: commit trigger -> encrypted commit -> switch to manual -> encrypted commit', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ges-e2e-commit-to-manual-'));
  const { repoDir, env, ageKeyPath } = bootstrapConsumerWorkspace(tempRoot, {
    encryptionKey: 'age',
    ageKeyPath: '~/.age/key.txt',
    encryptionTrigger: 'commit'
  }, { useFakeSsh: true });

  runReconfigure(repoDir, env);

  const envFilePath = path.join(repoDir, '.env');
  fs.writeFileSync(envFilePath, 'APP_MODE=commit-phase\n');
  runCommand('git', ['add', '-f', '.env'], { cwd: repoDir, env });
  runCommand('git', ['commit', '-m', 'security: commit trigger encrypted update'], { cwd: repoDir, env });
  assertCommitContainsEncryptedSecrets(repoDir, env);

  const hookPath = path.join(repoDir, '.git', 'hooks', 'pre-commit');
  assert.equal(fs.existsSync(hookPath), true);

  writeRepoConfig(repoDir, {
    encryptionKey: 'age',
    ageKeyPath: '~/.age/key.txt',
    encryptionTrigger: 'manual'
  });

  runReconfigure(repoDir, env);
  assert.equal(fs.existsSync(hookPath), false);

  fs.writeFileSync(envFilePath, 'APP_MODE=manual-phase\n');
  runCommand('npx', ['ges', 'push', '-m', 'security: manual trigger encrypted update'], { cwd: repoDir, env });
  assertCommitContainsEncryptedSecrets(repoDir, env);
  assert.equal(runCommand('git', ['ls-files', '.env'], { cwd: repoDir, env }), '');
});

integrationTest('migration path: manual trigger -> multiple encrypted commits -> switch to commit -> encrypted commit', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ges-e2e-manual-to-commit-'));
  const { repoDir, env, ageKeyPath } = bootstrapConsumerWorkspace(tempRoot, {
    encryptionKey: 'age',
    ageKeyPath: '~/.age/key.txt',
    encryptionTrigger: 'manual'
  }, { useFakeSsh: true });

  runReconfigure(repoDir, env);

  const envFilePath = path.join(repoDir, '.env');
  fs.writeFileSync(envFilePath, 'ROLLING=one\n');
  runCommand('npx', ['ges', 'push', '-m', 'security: manual encrypted one'], { cwd: repoDir, env });

  fs.writeFileSync(envFilePath, 'ROLLING=two\n');
  runCommand('npx', ['ges', 'push', '-m', 'security: manual encrypted two'], { cwd: repoDir, env });

  const hookPath = path.join(repoDir, '.git', 'hooks', 'pre-commit');
  assert.equal(fs.existsSync(hookPath), false);

  writeRepoConfig(repoDir, {
    encryptionKey: 'age',
    ageKeyPath: '~/.age/key.txt',
    encryptionTrigger: 'commit'
  });

  runReconfigure(repoDir, env);
  assert.equal(fs.existsSync(hookPath), true);

  fs.writeFileSync(envFilePath, 'ROLLING=three\n');
  runCommand('git', ['add', '-f', '.env'], { cwd: repoDir, env });
  runCommand('git', ['commit', '-m', 'security: commit trigger encrypted three'], { cwd: repoDir, env });
  assertCommitContainsEncryptedSecrets(repoDir, env);
});

integrationTest('migration path: age key -> ssh key -> age key keeps encrypted commits working', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ges-e2e-key-switch-'));
  const { repoDir, env, agePublicKey, sshPublicKey } = bootstrapConsumerWorkspace(tempRoot, {
    encryptionKey: 'age',
    ageKeyPath: '~/.age/key.txt',
    encryptionTrigger: 'manual'
  });

  runReconfigure(repoDir, env);

  const envFilePath = path.join(repoDir, '.env');
  fs.writeFileSync(envFilePath, 'ENC_KEY=age-initial\n');
  runCommand('npx', ['ges', 'push', '-m', 'security: age mode encrypted update'], { cwd: repoDir, env });
  assertCommitContainsEncryptedSecrets(repoDir, env);

  writeRepoConfig(repoDir, {
    encryptionKey: 'ssh',
    sshKeyPath: '~/.ssh/id_ed25519',
    encryptionTrigger: 'manual'
  });
  runReconfigure(repoDir, env);
  runCommand('npx', ['ges', 'add-ssh-key', sshPublicKey], { cwd: repoDir, env });

  fs.writeFileSync(envFilePath, 'ENC_KEY=ssh-phase\n');
  runCommand('npx', ['ges', 'push', '-m', 'security: ssh mode encrypted update'], { cwd: repoDir, env });
  assertCommitContainsEncryptedSecrets(repoDir, env);

  const recipientsAfterSsh = fs.readFileSync(path.join(repoDir, '.agerecipients'), 'utf-8');
  assert.match(recipientsAfterSsh, /ssh-ed25519|ssh-rsa|ecdsa-sha2/);

  writeRepoConfig(repoDir, {
    encryptionKey: 'age',
    ageKeyPath: '~/.age/key.txt',
    encryptionTrigger: 'manual'
  });
  runReconfigure(repoDir, env);
  fs.writeFileSync(path.join(repoDir, '.agerecipients'), `${agePublicKey}\n`);

  fs.writeFileSync(envFilePath, 'ENC_KEY=age-final\n');
  runCommand('npx', ['ges', 'push', '-m', 'security: age mode encrypted final'], { cwd: repoDir, env });
  assertCommitContainsEncryptedSecrets(repoDir, env);

  const recipientsAfterAge = fs.readFileSync(path.join(repoDir, '.agerecipients'), 'utf-8');
  assert.match(recipientsAfterAge, /^age1/m);
});
