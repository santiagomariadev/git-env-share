# AI Contributor Guide for git-env-share

This guide is for any coding model that needs to work safely and effectively in this repository.

## Mission

Maintain and improve git-env-share without breaking security guarantees.

Primary goal:
- Keep raw .env files out of Git history
- Keep tracked .secret.env* artifacts encrypted
- Preserve a predictable CLI for users

## Project Snapshot

- Stack: TypeScript on Node.js (Node 18+)
- Build output: dist/
- Main CLI: ges
- Package type: npm library with bin entrypoint

Core docs to read first:
- README.md
- DEVELOPMENT.md
- package.json scripts

## Architecture Map

- src/bin/
  - User-facing and internal CLI commands (init, reconfigure, stage, push, verify, smudge, precommit)
- src/config/
  - Config defaults, parsing, normalization, and precedence
- src/scripts/
  - Setup and repository wiring logic
- src/utils/
  - Shared helpers for git operations, env workflows, recipients, file IO, and text normalization
- test/
  - Node test runner tests, including integration/e2e flows

## Critical Invariants

1. Config contract
- Use encryptionKey with values age or ssh.
- Do not introduce or rely on config.mode.
- Keep encryptionTrigger semantics consistent: commit or manual.

2. Config precedence
- .git-env-share.config overrides package.json git-env-share block.
- Preserve this behavior in config reads and setup flows.

3. Workflow guardrails
- Manual commands (ges stage, ges push) must fail when trigger is commit.
- Commit-mode hooks must keep working when trigger is commit.

4. Security posture
- Never stage raw .env files as tracked artifacts.
- Keep .secret.env* as the tracked encrypted artifacts.
- Preserve conflict-marker protections before encryption.

5. CLI compatibility
- Keep the npx ges <subcommand> surface stable unless intentionally changing behavior.
- If behavior changes, update README and tests in the same patch.

## Safe Change Procedure

1. Understand scope
- Read the relevant command in src/bin/ and the helper modules it depends on.
- Check tests that cover this path before editing.

2. Make minimal edits
- Prefer small, targeted changes.
- Avoid unrelated refactors while fixing a bug or adding a feature.

3. Preserve UX and docs
- Keep command names and error guidance consistent.
- Update README.md when user-visible behavior changes.

4. Validate locally
- Run the command sequence in Validation Commands.
- Add or update tests for every behavior change.

5. Report clearly
- Summarize changed files, why each changed, and exactly which checks passed.

## Validation Commands

Run these after code changes:

1. npm run build
2. npm run check
3. npm test

Integration path (slower, optional unless needed):

1. GIT_ENV_SHARE_RUN_INTEGRATION=1 npm test

Notes:
- Integration tests depend on local tools like git, age, and ssh-keygen.
- If those are missing, document the limitation in your final report.

## Testing Strategy by Change Type

- Config parsing change:
  - Update or add tests around src/config and parse option helpers.
- CLI argument or behavior change:
  - Update tests that call parseInitOptions, parseSetupOptions, or command wrappers.
- Hook/filter workflow change:
  - Prefer coverage in integration tests and verify staged/tracked file behavior.
- Env encryption flow change:
  - Verify raw .env staging is rejected/unstaged and .secret.env* behavior remains intact.

## High-Risk Areas

Treat edits here with extra caution:

- src/utils/envWorkflow.ts
- src/scripts/setup.ts
- src/bin/smudge.ts
- src/bin/pre-commit.ts
- src/config/index.ts

When touching these files, prioritize regression tests and explicit manual verification notes.

## Coding Expectations

- Follow existing TypeScript style and naming.
- Keep functions cohesive and side effects explicit.
- Reuse shared helpers instead of duplicating git or fs logic.
- Prefer atomic file writes where supported by existing utilities.

## Commit/PR-Quality Output for Another Model

When you finish a task, produce:

1. What changed
- Bullet list of files edited and behavior impact.

2. Why it changed
- Link each edit to the requirement or bug.

3. How it was validated
- Exact commands run and pass/fail status.

4. Risk notes
- Any unresolved concerns, assumptions, or follow-ups.

## Quick Command Reference

- npx ges init
- npx ges reconfigure
- npx ges stage
- npx ges push
- npx ges generate-key
- npx ges add-key <key|user>
- npx ges add-ssh-key <key>
- npx ges add-github-user <username>
- npx ges compare-incoming
- npx ges verify

If uncertain, prefer preserving current behavior and adding tests before introducing broader changes.
