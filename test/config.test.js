const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadGitEnvShareConfig, resolvePrivateKeyPath } = require('../config');

test('reads config from package.json with age as default', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ges-package-'));

  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    'git-env-share': { mode: 'age', ageKeyPath: '~/.age/key.txt' }
  }, null, 2));

  const config = loadGitEnvShareConfig(dir);

  assert.equal(config.mode, 'age');
  assert.equal(config.ageKeyPath, '~/.age/key.txt');
});

test('prefers .git-env-share.config over package.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ges-config-'));

  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    'git-env-share': { mode: 'age' }
  }, null, 2));
  fs.writeFileSync(path.join(dir, '.git-env-share.config'), JSON.stringify({
    mode: 'ssh', sshKeyPath: '~/.ssh/id_ed25519'
  }, null, 2));

  const config = loadGitEnvShareConfig(dir);

  assert.equal(config.mode, 'ssh');
  assert.equal(config.sshKeyPath, '~/.ssh/id_ed25519');
});

test('resolves an existing private key from config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ges-ssh-'));
  const keyPath = path.join(dir, '.ssh', 'id_ed25519');

  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, 'PRIVATE KEY');

  const resolved = resolvePrivateKeyPath({ mode: 'ssh', sshKeyPath: keyPath }, dir);

  assert.equal(resolved, keyPath);
});
