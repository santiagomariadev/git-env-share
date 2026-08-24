# git-shared-envs

A Node.js package for securily share environment configurations in-repo.
Transparent, asymmetric file encryption (`age`) with automated Git hooks and SSH access checks for your sensitive files (`.env`).

## Prerequisites

Before installing, all team members must have the `age` CLI tool installed locally:

* **macOS:** `brew install age`
* **Linux (Debian/Ubuntu):** `sudo apt install age`
* **Windows (Chocolatey):** `choco install age`

## Installation

1. Install package as dev dependency
    ```bash
    $ npm install --save-dev git-shared-envs
    ```

2. Configure the repo mode in either `package.json` or `.git-env-share.config`.

    Default mode is `age`:

    ```json
    {
      "git-env-share": {
        "mode": "age",
        "ageKeyPath": "~/.age/key.txt"
      }
    }
    ```

    Or for SSH-based recipients:

    ```json
    {
      "git-env-share": {
        "mode": "ssh",
        "sshKeyPath": "~/.ssh/id_ed25519",
        "githubUsernames": ["octocat"]
      }
    }
    ```

    A project-level `.git-env-share.config` file takes precedence over `package.json` when both exist.

    ```json
    {
      "mode": "ssh",
      "sshKeyPath": "~/.ssh/id_ed25519"
    }
    ```

3. The package will run a postinstall script automatically to:

    - Configure local Git filter drivers in .git/config.
    - Configure .gitattributes to route .secret* files through the driver.
    - Add raw secret files (.env) to .gitignore.
    - Install the pre-commit hook in .git/hooks/pre-commit.

## Team Onboarding Workflow

1. New Member (Joining the Project)

    In `age` mode, run the following command to generate an age private key at `~/.age/key.txt` (if missing):

    ```bash
    $ npx git-env-share-generate-key
    ```

    In `ssh` mode, make sure your SSH key exists and matches the GitHub account the repo admin will authorize, for example:

    ```bash
    $ ssh-keygen -t ed25519 -C "you@example.com"
    ```

2. Project Admin (Adding the New Member)

    In `age` mode, once the new member shares their public key (`age1...`), run:

    ```bash
    $ npx git-env-share-add-key age1...
    $ git commit -m "security: add new team member key"
    $ git push
    ```

    In `ssh` mode, add the GitHub username instead. The package fetches that user's public SSH keys and appends them to `.agerecipients`:

    ```bash
    $ npx git-env-share-add-key octocat
    $ git commit -m "security: add new team member ssh key"
    $ git push
    ```

3. New Member (Pulling Access)

    The smudge filter automatically decrypts `.secret.env*` files using the configured private key path and creates the local `.env` files.

    ```bash
    $ git pull
    ```

## Daily Workflow

1. Edit your local `.env` or `.env*` files normally.
2. Run `git commit`.
3. The pre-commit hook will:
    - Prompt if you want to update secret files.
    - Verify your repository SSH permissions.
    - Encrypt `.env` into `.secret.env` file.
    - Unstage raw `.env` files if staged by accident.
    - Stage the encrypted `.secret.env` file automatically.

## Contributing

Contributions are welcome! Please feel free to submit a pull request.

## License

MIT