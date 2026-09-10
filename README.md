# git-env-share

A TypeScript-first Node.js tool for securely sharing environment files in a Git repository.
It encrypts sensitive `.env` files with `age`, keeps raw values out of the repo, and supports SSH-based recipient management for team access.

## Why this package is useful

- Keeps `.env` values out of Git by default
- Encrypts files automatically before commit by default, with optional manual commands
- Restores decrypted local files on checkout, pull, and clone
- Works with either `age` keys or SSH recipient authorizations
- Exposes a small typed API for config-aware tooling

## Prerequisites

Every team member should have the `age` CLI installed locally:

- macOS: `brew install age`
- Linux (Debian/Ubuntu): `sudo apt install age`
- Windows (Chocolatey): `choco install age`

## Installation

1. Install the package in the repo you want to protect:

   ```bash
   npm install --save-dev git-env-share
   ```

2. Create or update the repo config in either `package.json` or `.git-env-share.config`.

   Default `age` encryption key:

   ```json
   {
     "git-env-share": {
       "encryptionKey": "age",
       "ageKeyPath": "~/.age/key.txt",
       "encryptionTrigger": "commit"
     }
   }
   ```

   SSH encryption key:

   ```json
   {
     "git-env-share": {
       "encryptionKey": "ssh",
       "sshKeyPath": "~/.ssh/id_ed25519",
       "githubUsernames": ["octocat"],
       "encryptionTrigger": "commit"
     }
   }
   ```

   A repo-level `.git-env-share.config` file takes precedence over `package.json` when both exist.

   ```json
   {
     "encryptionKey": "age",
     "ageKeyPath": "~/.age/key.txt",
     "encryptionTrigger": "commit"
   }
   ```

3. Run the repo setup command once the config is in place:

   ```bash
   npx ges init
   ```

   You can also pass the repo choices directly when you want to skip the interactive prompts:

   ```bash
   npx ges init --key age --trigger commit
   npx ges init --key ssh --trigger manual
   ```

   Use `--dry-run` to preview the repo changes without modifying hooks or Git settings:

   ```bash
   npx ges init --dry-run
   ```

   This configures the repository for you by:

   - updating the local Git filter settings
   - adding `.secret.*` entries to `.gitattributes`
   - ignoring raw `.env` files locally
   - installing the pre-commit hook when `encryptionTrigger` is `commit`
   - preparing manual encryption flows when `encryptionTrigger` is `manual`

## Quick start for a team repo

1. Install the package and add a repo config.
2. Run `npx ges init` in the project root.
3. Share the generated public key or GitHub username with the repo admin.
4. Commit and push the encrypted `.secret.*` artifacts as normal.
5. New team members pull the repo and the smudge filter restores their local `.env` files automatically.

## Common commands

These are the main commands users will run:

```bash
npx ges init
npx ges init --key ssh --trigger manual
npx ges init --dry-run
npx ges reconfigure
npx ges reconfigure --dry-run
npx ges stage
npx ges push
npx ges generate-key
npx ges add-key age1...
npx ges add-ssh-key "ssh-ed25519 AAAA..."
npx ges add-github-user octocat
```

Notes:

- `ges init` creates a repo config when missing and accepts `--key` and `--trigger` arguments.
- `--key` accepts `age` or `ssh` and chooses the encryption identity model.
- `--trigger` accepts `commit` or `manual` and chooses when encryption runs.
- `--dry-run` previews the repository changes before writing to `.gitattributes`, `.agerecipients`, Git config, or hooks.
- `ges reconfigure` reapplies the Git filter and hook setup using the current config.
- `ges add-key` is for adding an Age public key.
- `ges add-github-user` is for SSH mode recipients.
- `ges add-ssh-key` adds a raw SSH public key directly.

## Init arguments

`npx ges init` supports explicit repo setup choices without going through the interactive prompt flow:

```bash
npx ges init --key age --trigger commit
npx ges init --key ssh --trigger manual
npx ges init --help
```

- `--key` selects the encryption backend: `age` or `ssh`
- `--trigger` selects when encryption runs: `commit` or `manual`
- `--dry-run` shows the planned repository changes without writing them
- `--help` prints the available options and examples

This keeps the mental model simple: choose how you authenticate (`age` vs `ssh`), then choose when the repo encrypts files (`commit` vs `manual`).

## AGE MODE - Team onboarding workflow

Use this path when the repository is configured with `encryptionKey: "age"`.

### 1) New member joins the project

Generate a private key if needed:

```bash
npx ges generate-key
```

### 2) Repo admin adds the new member

Once the teammate shares their public key (`age1...`), run:

```bash
npx ges add-key age1...
git add .agerecipients
git commit -m "security: add team member key"
git push
```

### 3) New member pulls access

The smudge filter decrypts `.secret.env*` files and recreates the local `.env` file automatically:

```bash
git pull
```

If a local environment file is missing, generate or restore it through the normal Git checkout flow; the project is designed to keep raw `.env` values out of version control.

## SSH MODE - Team onboarding workflow

Use this path when the repository is configured with `encryptionKey: "ssh"`.

### 1) New member joins the project

Ensure the teammate has a valid SSH key:

```bash
ssh-keygen -t ed25519 -C "you@example.com"
```

### 2) Repo admin adds the new member

Add the GitHub username instead:

```bash
npx ges add-github-user octocat
git add .agerecipients
git commit -m "security: add ssh recipient"
git push
```

### 3) New member pulls access

The smudge filter decrypts `.secret.env*` files and recreates the local `.env` file automatically:

```bash
git pull
```

If a local environment file is missing, generate or restore it through the normal Git checkout flow; the project is designed to keep raw `.env` values out of version control.

For local development on this package itself, see [DEVELOPMENT.md](DEVELOPMENT.md).

## Daily workflow

By default, git-env-share uses commit-time encryption (`encryptionTrigger: "commit"`). This fits the common team pattern where `.env` files stay ignored and only `.secret.env*` files are tracked.

### Default commit-based flow

```bash
# edit your .env files
git commit -m "update app config"
```

In commit mode, the pre-commit hook:

- detects `.env*` files in the working tree
- encrypts them into `.secret.env*`
- stages only the encrypted `.secret.*` artifacts (and `.gitignore` updates)

### Manual flow with explicit commands

If your team prefers controlling exactly when encrypted artifacts are staged/committed:

```bash
# encrypt and stage .secret.env* files
npx ges stage

# commit manually
git commit -m "security: refresh encrypted env files"
```

Or do both steps in one command:

```bash
npx ges push -m "security: refresh encrypted env files"
```

`ges push` stages encrypted files and then runs `git commit`. It does not run `git push`.

Example config for manual trigger:

```json
{
  "git-env-share": {
    "encryptionKey": "age",
    "encryptionTrigger": "manual"
  }
}
```

Example config for commit trigger:

```json
{
  "git-env-share": {
    "encryptionKey": "age",
    "encryptionTrigger": "commit"
  }
}
```

## Switching between manual and commit modes

Use this when you want to move from one trigger strategy to the other.

### From `manual` to `commit` (recommended default)

1. Update the repo config:

   ```json
   {
     "git-env-share": {
       "encryptionKey": "age",
       "encryptionTrigger": "commit"
     }
   }
   ```

2. Re-run setup so the pre-commit hook is installed:

   ```bash
   npx ges reconfigure
   ```

3. Commit as usual. The hook will encrypt `.env*` content into `.secret.env*` before the commit succeeds.

Precautions:

- make sure the repo is clean before switching if you want a predictable migration
- review any existing `.secret.*` files and confirm they match the current `.env` state
- if you previously had a custom pre-commit hook, verify the git-env-share hook was appended safely instead of replacing existing logic

### From `commit` to `manual`

1. Update the repo config:

   ```json
   {
     "git-env-share": {
       "encryptionKey": "age",
       "encryptionTrigger": "manual"
     }
   }
   ```

2. Re-run setup to keep the Git filter configuration in sync:

   ```bash
   npx ges reconfigure
   ```

3. Remove or disable the old pre-commit hook if you no longer want commit-time encryption:

   ```bash
   rm .git/hooks/pre-commit
   ```

   If the hook was previously appended rather than replaced, keep the existing script and remove only the git-env-share line you added.

4. From then on, use `ges stage` (or `ges push`) whenever you want to refresh encrypted artifacts.

Precautions:

- if you switch back to manual mode, run `ges stage` before committing `.secret.*` updates
- check your `.secret.*` files before pushing to avoid committing stale encrypted content
- confirm no duplicate or conflicting hook entries remain in `.git/hooks/pre-commit`

## Contributing

Contributions are welcome. Please open a pull request with a clear explanation of the change.

## License

MIT