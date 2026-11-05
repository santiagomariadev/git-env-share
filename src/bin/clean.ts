#!/usr/bin/env node
import * as fs from 'node:fs';
import { describeAgeCiphertextHeaders, isAgeCiphertext } from '../utils/ageCiphertext';

export function runClean(argv = process.argv.slice(2)) {
  const sourcePath = argv[0];
  const input = fs.readFileSync(0);

  if (!isAgeCiphertext(input)) {
    const fileLabel = sourcePath ? ` for ${sourcePath}` : '';
    console.error(`✕ Refusing to stage non-age ciphertext${fileLabel}.`);
    console.error(`Expected input to start with ${describeAgeCiphertextHeaders()}.`);
    process.exit(1);
  }

  process.stdout.write(input);
}

if (require.main === module) {
  runClean();
}
