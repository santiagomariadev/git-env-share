const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { loadGitEnvShareConfig, resolvePrivateKeyPath, hasExplicitConfig, describeGitEnvShareConfig } = require('../dist/config');
const { parseInitOptions } = require('../dist/bin/init');
const { parseSetupOptions } = require('../dist/scripts/setup');
const { syncGitHubRecipientsFromConfig } = require('../dist/utils/sshEnvEncryption');
const { shouldSkipRemoteValidation } = require('../dist/utils/git');
const { shouldRunPreCommitHook } = require('../dist/bin/pre-commit');

const runIntegrationTests = process.env.GIT_ENV_SHARE_RUN_INTEGRATION === '1';

// This helper executes real Git commands against a temporary repo. We keep the test close to
// production behavior without mocking Git itself, which is important for filter-driven workflows.
function runGit(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// We use tiny shell scripts here only as stand-ins for the real age encryption/decryption logic.
// The test is still exercising the real Git filter lifecycle: clean/smudge on add/checkout/pull.
function writeFilterScripts(sharedRoot) {
  const encryptScript = path.join(sharedRoot, 'encrypt-env.sh');
  const decryptScript = path.join(sharedRoot, 'decrypt-env.sh');

  fs.writeFileSync(encryptScript, '#!/usr/bin/env bash\ninput=$(cat)\nprintf "encrypted:%s" "$input"\n');
  fs.writeFileSync(decryptScript, '#!/usr/bin/env bash\ninput=$(cat)\nprintf "%s" "${input#encrypted:}"\n');

  fs.chmodSync(encryptScript, 0o755);
  fs.chmodSync(decryptScript, 0o755);

  return { encryptScript, decryptScript };
}

function initRepoWithFilter(repoRoot, encryptScript, decryptScript) {
  // A temp Git repo is the most faithful way to test Git filters without touching the developer machine.
  runGit(['init', '-b', 'main'], repoRoot);
  runGit(['config', 'user.name', 'Test User'], repoRoot);
  runGit(['config', 'user.email', 'test@example.com'], repoRoot);
  runGit(['config', 'filter.fake-env.clean', `bash ${encryptScript}`], repoRoot);
  runGit(['config', 'filter.fake-env.smudge', `bash ${decryptScript}`], repoRoot);
  runGit(['config', 'filter.fake-env.required', 'true'], repoRoot);

  // .gitattributes is the Git contract that triggers the filter for .env files.
  fs.writeFileSync(path.join(repoRoot, '.gitattributes'), '.env filter=fake-env\n');
}

test('reads config from package.json with age as default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ges-package-'));

  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    'git-env-share': { encryptionKey: 'age', ageKeyPath: '~/.age/key.txt' }
  }, null, 2));

  const config = loadGitEnvShareConfig(dir);

  assert.equal(config.encryptionKey, 'age');
  assert.equal(config.ageKeyPath, '~/.age/key.txt');
});

test('falls back to the age default when encryptionKey is invalid', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ges-invalid-key-'));

  fs.writeFileSync(path.join(dir, '.git-env-share.config'), JSON.stringify({
    encryptionKey: 'invalid', sshKeyPath: '~/.ssh/id_ed25519'
  }, null, 2));

  const config = loadGitEnvShareConfig(dir);

  assert.equal(config.encryptionKey, 'age');
  assert.equal(config.sshKeyPath, '~/.ssh/id_ed25519');
});

test('prefers .git-env-share.config over package.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ges-config-'));

  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    'git-env-share': { encryptionKey: 'age' }
  }, null, 2));
  fs.writeFileSync(path.join(dir, '.git-env-share.config'), JSON.stringify({
    encryptionKey: 'ssh', sshKeyPath: '~/.ssh/id_ed25519'
  }, null, 2));

  const config = loadGitEnvShareConfig(dir);

  assert.equal(config.encryptionKey, 'ssh');
  assert.equal(config.sshKeyPath, '~/.ssh/id_ed25519');
});

test('resolves an existing private key from config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ges-ssh-'));
  const keyPath = path.join(dir, '.ssh', 'id_ed25519');

  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, 'PRIVATE KEY');

  const resolved = resolvePrivateKeyPath({ encryptionKey: 'ssh', sshKeyPath: keyPath }, dir);

  assert.equal(resolved, keyPath);
});

test('detects explicit repo configuration before prompting for init', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ges-explicit-'));

  assert.equal(hasExplicitConfig(dir), false);

  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    'git-env-share': { encryptionKey: 'age' }
  }, null, 2));

  assert.equal(hasExplicitConfig(dir), true);

  const secondDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ges-config-file-'));
  fs.writeFileSync(path.join(secondDir, '.git-env-share.config'), JSON.stringify({ encryptionKey: 'ssh' }, null, 2));

  assert.equal(hasExplicitConfig(secondDir), true);
});

test('describes the current configuration in plain-language setup guidance', () => {
  const config = loadGitEnvShareConfig(process.cwd(), {
    encryptionKey: 'ssh',
    encryptionTrigger: 'manual'
  });

  const summary = describeGitEnvShareConfig(config);

  assert.match(summary, /SSH/i);
  assert.match(summary, /manual/i);
  assert.match(summary, /ges stage|ges push/i);
});

test('parses explicit init flags for auth and trigger choices', () => {
  const parsed = parseInitOptions(['--key', 'ssh', '--trigger', 'manual']);

  assert.equal(parsed.encryptionKey, 'ssh');
  assert.equal(parsed.encryptionTrigger, 'manual');
  assert.equal(parsed.dryRun, false);

  const defaults = parseInitOptions([]);
  assert.equal(defaults.encryptionKey, 'age');
  assert.equal(defaults.encryptionTrigger, 'commit');
  assert.equal(defaults.dryRun, false);
});

test('parses dry-run preview flags for init and setup', () => {
  const parsedInit = parseInitOptions(['--dry-run', '--trigger', 'manual']);
  assert.equal(parsedInit.dryRun, true);
  assert.equal(parsedInit.encryptionTrigger, 'manual');

  const parsedSetup = parseSetupOptions(['--dry-run', '--trigger', 'manual']);
  assert.equal(parsedSetup.dryRun, true);
  assert.equal(parsedSetup.encryptionTrigger, 'manual');

  const defaults = parseInitOptions([]);
  assert.equal(defaults.dryRun, false);
});

test('parses dry-run preview flags for setup', () => {
  const parsed = parseSetupOptions(['--dry-run', '--trigger', 'manual']);

  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.encryptionTrigger, 'manual');

  const defaults = parseSetupOptions([]);
  assert.equal(defaults.dryRun, false);
  assert.equal(defaults.encryptionTrigger, 'commit');
});

test('rebuilds .agerecipients from githubUsernames when SSH mode is configured', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ges-sync-'));
  const recipientsPath = path.join(dir, '.agerecipients');
  const sshPublicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIexampleuser';

  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    'git-env-share': {
      encryptionKey: 'ssh',
      githubUsernames: ['octocat']
    }
  }, null, 2));

  fs.writeFileSync(recipientsPath, '# old age key\nage1oldrecipient\n');

  const server = require('node:http').createServer((req, res) => {
    if (req.url === '/octocat.keys') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`${sshPublicKey}\n`);
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const keys = await syncGitHubRecipientsFromConfig(dir, { baseUrl: `http://127.0.0.1:${port}` });

    assert.deepEqual(keys, [sshPublicKey]);

    const fileContents = fs.readFileSync(recipientsPath, 'utf-8');
    assert.ok(fileContents.includes(sshPublicKey));
    assert.ok(!fileContents.includes('age1oldrecipient'));
    assert.ok(fileContents.startsWith('# Auto-generated by git-env-share for SSH mode'));
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test('skips SSH validation for HTTPS remotes and honors config opt-out', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ges-remote-'));

  assert.equal(shouldSkipRemoteValidation('https://github.com/example/repo.git'), true);
  assert.equal(shouldSkipRemoteValidation('git@github.com:example/repo.git'), false);

  const config = loadGitEnvShareConfig(dir);
  assert.equal(config.enabled, true);
  assert.equal(config.paused, false);
  assert.equal(config.encryptionTrigger, 'commit');

  const disabledConfig = loadGitEnvShareConfig(dir, { enabled: false, encryptionTrigger: 'manual' });
  assert.equal(disabledConfig.enabled, false);
  assert.equal(disabledConfig.encryptionTrigger, 'manual');

  const invalidConfig = loadGitEnvShareConfig(dir, { encryptionTrigger: 'unexpected' });
  assert.equal(invalidConfig.encryptionTrigger, 'commit');
});

test('pre-commit hook respects encryption trigger mode', () => {
  const manualDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ges-manual-hook-'));
  fs.writeFileSync(path.join(manualDir, '.git-env-share.config'), JSON.stringify({ encryptionTrigger: 'manual' }, null, 2));

  const commitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ges-commit-hook-'));
  fs.writeFileSync(path.join(commitDir, '.git-env-share.config'), JSON.stringify({ encryptionTrigger: 'commit' }, null, 2));

  assert.equal(shouldRunPreCommitHook(manualDir), false);
  assert.equal(shouldRunPreCommitHook(commitDir), true);
});

const integrationTest = runIntegrationTests ? test : test.skip;

// This is a Git contract test: we verify that the clean/smudge filter actually runs when Git
// stages, commits and restores a file. The test is intentionally skipped by default because it is
// slower and requires a real Git repository lifecycle.
integrationTest('applies real Git filter behavior for add, commit, and checkout', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ges-git-flow-'));
  const { encryptScript, decryptScript } = writeFilterScripts(root);
  initRepoWithFilter(root, encryptScript, decryptScript);

  // We write the raw env value then stage it. Git should invoke the clean filter and store the
  // transformed content instead of the plaintext version in the index.
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=value\n');
  runGit(['add', '.env'], root);

  const stagedBlob = runGit(['show', ':.env'], root).trim();
  assert.match(stagedBlob, /^encrypted:SECRET=value$/);

  // A commit should keep the transformed content in the repository history.
  runGit(['commit', '-m', 'Add env file'], root);
  const committedBlob = runGit(['show', 'HEAD:.env'], root).trim();
  assert.match(committedBlob, /^encrypted:SECRET=value$/);

  // Simulate a local modification and restore the file via checkout. Git should materialize the
  // clean version from the repository (or the smudge pipeline), returning the original secret value.
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=updated\n');
  runGit(['checkout', '--', '.env'], root);

  assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'SECRET=value');
});

// This second integration test proves the same filter pipeline works across a clone/pull workflow,
// which is one of the main real-world use cases for encrypted env files in shared repos.
integrationTest('pulls updated encrypted content through the same Git filter flow', () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ges-pull-flow-'));
  const originDir = path.join(baseDir, 'origin');
  const cloneDir = path.join(baseDir, 'clone');
  const { encryptScript, decryptScript } = writeFilterScripts(baseDir);

  fs.mkdirSync(originDir);
  initRepoWithFilter(originDir, encryptScript, decryptScript);

  // Start with a committed encrypted value in the origin repo, then clone it into a second repo.
  fs.writeFileSync(path.join(originDir, '.env'), 'SECRET=value\n');
  runGit(['add', '.env'], originDir);
  runGit(['commit', '-m', 'Initial env'], originDir);

  runGit(['clone', originDir, cloneDir], baseDir);
  initRepoWithFilter(cloneDir, encryptScript, decryptScript);
  runGit(['reset', '--hard', 'HEAD'], cloneDir);

  const clonedEnv = fs.readFileSync(path.join(cloneDir, '.env'), 'utf8');
  assert.equal(clonedEnv, 'SECRET=value');

  // Update the source repo and pull the change into the clone. The working tree should receive the
  // new decrypted value after the remote update is fetched and checked out.
  fs.writeFileSync(path.join(originDir, '.env'), 'SECRET=updated\n');
  runGit(['add', '.env'], originDir);
  runGit(['commit', '-m', 'Update env'], originDir);

  runGit(['pull', '--ff-only', 'origin', 'main'], cloneDir);
  assert.equal(fs.readFileSync(path.join(cloneDir, '.env'), 'utf8'), 'SECRET=updated');
});
