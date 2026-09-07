# git-shared-envs

A TypeScript-first Node.js tool for securely sharing environment files in a Git repository.
It encrypts sensitive `.env` files with `age`, keeps raw values out of the repo, and supports SSH-based recipient management for team access.

## Why this package is useful

- Keeps `.env` values out of Git by default
- Encrypts files automatically when they are staged or committed, depending on config
- Restores decrypted local files on checkout, pull, and clone
- Works with either `age` keys or SSH recipient authorizations
- Exposes a small typed API for config-aware tooling

## TypeScript usage

```ts
import {
  loadGitEnvShareConfig,
  resolvePrivateKeyPath,
  type GitEnvShareConfig
} from 'git-shared-envs';

const config: GitEnvShareConfig = loadGitEnvShareConfig();
const keyPath = resolvePrivateKeyPath(config);
console.log(config.mode, keyPath);
```

## Prerequisites

Every team member should have the `age` CLI installed locally:

- macOS: `brew install age`
- Linux (Debian/Ubuntu): `sudo apt install age`
- Windows (Chocolatey): `choco install age`

## Installation

1. Install the package as a dev dependency:

   ```bash
   npm install --save-dev git-shared-envs
   ```

2. Configure the repo in either `package.json` or `.git-env-share.config`.

   Default `age` mode:

   ```json
   {
     "git-env-share": {
       "mode": "age",
       "ageKeyPath": "~/.age/key.txt"
     }
   }
   ```

   SSH mode:

   ```json
   {
     "git-env-share": {
       "mode": "ssh",
       "sshKeyPath": "~/.ssh/id_ed25519",
       "githubUsernames": ["octocat"]
     }
   }
   ```

   A repo-level `.git-env-share.config` file takes precedence over `package.json` when both exist.

   ```json
   {
     "mode": "ssh",
     "sshKeyPath": "~/.ssh/id_ed25519"
   }
   ```

3. The package will configure the repository for you:

   - update local Git filter settings
   - add `.secret.*` entries to `.gitattributes`
   - ignore raw `.env` files locally
   - optionally install a pre-commit hook when `encryptionTrigger` is set to `commit`

## Common commands

These are the main commands users will run:

```bash
npx git-env-share-init
npx git-env-share-reconfigure
npx git-env-share-generate-key
npx git-env-share-add-key age1...
npx git-env-share-add-ssh-key "ssh-ed25519 AAAA..."
npx git-env-share-add-github-user octocat
```

`git-env-share-init` creates a repo config when missing, while `git-env-share-reconfigure` re-applies the Git filter and hook setup using the current config.

## Team onboarding workflow

### 1) New member joins the project

If the project uses `age` mode, generate a private key if needed:

```bash
npx git-env-share-generate-key
```

If the project uses SSH mode, ensure the teammate has a valid SSH key:

```bash
ssh-keygen -t ed25519 -C "you@example.com"
```

### 2) Repo admin adds the new member

In `age` mode, once the teammate shares their public key (`age1...`), run:

```bash
npx git-env-share-add-key age1...
git commit -m "security: add team member key"
git push
```

In `ssh` mode, add the GitHub username instead:

```bash
npx git-env-share-add-key octocat
git commit -m "security: add ssh recipient"
git push
```

### 3) New member pulls access

The smudge filter decrypts `.secret.env*` files and recreates the local `.env` file automatically:

```bash
git pull
```

## Daily workflow

By default, git-env-share encrypts when files are staged (`git add`). This is the safest default and the recommended setting for most repos.

If you prefer commit-time encryption instead, set `encryptionTrigger` to `"commit"` in the repo config. In that mode, git-env-share installs a pre-commit hook and encrypts right before the commit is created.

### Default stage-based flow

```bash
# edit your .env file
# stage it

git add .
```

The configured trigger will:

- detect `.env` files and update the encrypted secret files
- keep raw `.env` files ignored locally
- stage the generated `.secret.env` files automatically in stage mode

### Optional commit-based flow

```bash
# edit your .env file
git commit -m "update env"
```

In commit mode, the pre-commit hook re-encrypts the file before the commit completes and stages the encrypted output as needed.

Example config for stage mode:

```json
{
  "git-env-share": {
    "mode": "age",
    "encryptionTrigger": "stage"
  }
}
```

Example config for commit mode:

```json
{
  "git-env-share": {
    "mode": "age",
    "encryptionTrigger": "commit"
  }
}
```

## Switching between stage and commit modes

Use this when you want to move from one trigger strategy to the other.

### From `stage` to `commit`

1. Update the repo config:

   ```json
   {
     "git-env-share": {
       "mode": "age",
       "encryptionTrigger": "commit"
     }
   }
   ```

2. Re-run setup so the pre-commit hook is installed:

   ```bash
   npx git-env-share-reconfigure
   ```

3. Commit as usual. The hook will encrypt the file before the commit succeeds.

Precautions:

- make sure the repo is clean before switching if you want a predictable migration
- review any existing `.secret.*` files and confirm they match the current `.env` state
- if you previously had a custom pre-commit hook, verify the git-env-share hook was appended safely instead of replacing existing logic

### From `commit` to `stage`

1. Update the repo config:

   ```json
   {
     "git-env-share": {
       "mode": "age",
       "encryptionTrigger": "stage"
     }
   }
   ```

2. Re-run setup to keep the Git filter configuration in sync:

   ```bash
   npx git-env-share-reconfigure
   ```

3. Remove or disable the old pre-commit hook if you no longer want commit-time encryption:

   ```bash
   rm .git/hooks/pre-commit
   ```

   If the hook was previously appended rather than replaced, keep the existing script and remove only the git-env-share line you added.

4. From then on, a normal `git add .` will trigger the encrypted output.

Precautions:

- if you switch back to stage mode, re-stage any `.env` changes that were previously relying on the commit hook
- check your `.secret.*` files before pushing to avoid committing stale encrypted content
- confirm no duplicate or conflicting hook entries remain in `.git/hooks/pre-commit`

## Contributing

Contributions are welcome. Please open a pull request with a clear explanation of the change.

## License

MIT