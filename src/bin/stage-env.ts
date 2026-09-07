#!/usr/bin/env node
import { getGitRoot } from '../utils/git';
import { ensureManualMode, stageEnvSecrets } from '../utils/envWorkflow';

function runStageEnv() {
  try {
    const rootDir = getGitRoot();
    ensureManualMode(rootDir);
    const { envFiles, encryptedCount } = stageEnvSecrets(rootDir);

    if (envFiles.length === 0) {
      console.log('No .env files were found. Nothing to encrypt or stage.');
      process.exit(0);
    }

    console.log(`✓ Prepared ${encryptedCount} encrypted .secret file(s) for commit.`);
  } catch (error: any) {
    console.error('✕ stage-env command failed:', error.message);
    process.exit(1);
  }
}

runStageEnv();
