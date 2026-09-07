# Development guide

This project is written in TypeScript and compiled into the published `dist` folder for package releases.

## Local setup

```bash
npm install
```

The source lives in `src/`, and the production CLI entrypoints are generated from that source during the build step.

## Build

Compile the TypeScript sources:

```bash
npm run build
```

This writes the package output into `dist/`.

## Run tests

Run the project test suite:

```bash
npm test
```

This runs the build first and then executes the Node tests under `test/`.

## Pack for local verification

Create a tarball without publishing:

```bash
npm pack
```

This is useful to verify the package contents and CLI entrypoints before publishing.

## Publish

Before publishing, make sure the version is ready and the package builds cleanly:

```bash
npm run build
npm test
npm pack
```

Then publish:

```bash
npm publish
```

If you want to publish a scoped package or require a specific registry setup, include the usual npm registry flags as needed for your environment.

## Release workflow

A standard release flow is:

```bash
npm version patch   # or minor / major
npm run build
npm test
npm publish
```

## Notes for contributors

- Keep the source in `src/` as the single source of truth.
- Do not add duplicate root-level JS copies unless there is a documented reason.
- If you change CLI behavior, update the relevant tests and the user-facing docs in `README.md`.
