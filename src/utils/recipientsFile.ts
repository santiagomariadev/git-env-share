import * as fs from 'node:fs';
import * as path from 'node:path';

export function resolveRecipientsPath(
  rootDir: string,
  config: { recipientsFile?: string } = {},
): string {
  return path.join(rootDir, config.recipientsFile || '.agerecipients');
}

export function readRecipientsFileContent(recipientsPath: string): string {
  return fs.existsSync(recipientsPath) ? fs.readFileSync(recipientsPath, 'utf-8') : '';
}

export function ensureRecipientsFile(
  recipientsPath: string,
  header = '# Add age public keys (one per line)\n',
): void {
  if (!fs.existsSync(recipientsPath)) {
    fs.writeFileSync(recipientsPath, header);
  }
}
