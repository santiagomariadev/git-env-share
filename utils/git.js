const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function execGit(args, options = {}) {
  const command = Array.isArray(args) ? args.join(' ') : args;
  return execSync(`git ${command}`, {
    encoding: 'utf-8',
    stdio: options.stdio || 'pipe',
    ...options
  });
}

function getGitRoot() {
  return execGit('rev-parse --show-toplevel').trim();
}

function getGitDir() {
  return execGit('rev-parse --git-dir').trim();
}

function getGitHooksDir() {
  return execGit('rev-parse --git-path hooks').trim();
}

function getRemoteGitUrl() {
  try {
    const remoteUrl = execGit('config --get remote.origin.url || echo ""').trim();
    return remoteUrl || null;
  } catch (_error) {
    return null;
  }
}

function gitAdd(...paths) {
  const items = paths.filter(Boolean).flatMap((value) => {
    if (Array.isArray(value)) return value.filter(Boolean);
    return [value];
  });

  if (!items.length) return;
  execGit(['add', ...items.map((item) => `"${item}"`)]);
}

function gitRestoreStaged(...paths) {
  const items = paths.filter(Boolean).flatMap((value) => {
    if (Array.isArray(value)) return value.filter(Boolean);
    return [value];
  });

  if (!items.length) return;

  try {
    execGit(['restore', '--staged', ...items.map((item) => `"${item}"`)]);
  } catch (_error) {
    // Ignore if file was never staged.
  }
}

function gitResetPaths(...paths) {
  const items = paths.filter(Boolean).flatMap((value) => {
    if (Array.isArray(value)) return value.filter(Boolean);
    return [value];
  });

  if (!items.length) return;

  try {
    execGit(['reset', ...items.map((item) => `"${item}"`)]);
  } catch (_error) {
    // Ignore if no files matched.
  }
}

module.exports = {
  execGit,
  getGitDir,
  getGitHooksDir,
  getGitRoot,
  getRemoteGitUrl,
  gitAdd,
  gitResetPaths,
  gitRestoreStaged
};
