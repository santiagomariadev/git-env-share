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

2. The package will run a postinstall script automatically to:

    - Configure local Git filter drivers in .git/config.
    - Configure .gitattributes to route .secret* files through the driver.
    - Add raw secret files (.env) to .gitignore.
    - Install the pre-commit hook in .git/hooks/pre-commit.

## Team Onboarding Workflow

1. New Member (Joining the Project)

    Run the following command to generate an age private key at `~/.age/key.txt` (if missing)

    ```bash
    $ npx git-env-share-generate-key
    ```

2. Project Admin (Adding the New Member)

    Once the new member shares their public key (`age1...`), run the following commands to add it to the project and re-encrypt secrets

    ```bash
    $ npx git-env-share-add-key age1...
    $ git commit -m "security: add new team member key"
    $ git push
    ```

3. New Member (Pulling Access)

    The smudge filter automatically decrypts .secret.env* files using their private key (~/.age/key.txt) and creates their local env files

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