# Project Architecture

This is a Node.js application written in typescript that uses the following architecture:

- Codebase in `/src`
- bin files in `/src/bin`
- utils files in `/src/utils`
- config files in `/src/config`
- setup script in `/src/scripts/setup.ts`

## Coding Standards

- Use TypeScript for all new files
- Follow the existing naming conventions
- Write tests for all new features
- Use ESLint for linting
- Use Prettier for formatting
- Use Git for version control

# git-env-share

A TypeScript-first Node.js tool for securely sharing environment files in a Git repository.
It encrypts sensitive `.env` files with `age`, keeps raw values out of the repo, and supports SSH-based recipient management for team access.

## Why this package is useful

- Keeps `.env` values out of Git by default
- Encrypts files automatically before commit by default, with optional manual commands
- Keeps tracked `.secret.env*` files encrypted in the working tree and restores local `.env*` files via Git hooks
- Works with either `age` keys or SSH recipient authorizations
- Exposes a small typed API for config-aware tooling
