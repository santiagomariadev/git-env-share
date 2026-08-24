import * as fs from 'node:fs';
import * as readline from 'node:readline';

export default async function askQuestion(query: string): Promise<boolean> {
  let inputSource: NodeJS.ReadStream | NodeJS.ReadableStream = process.stdin;

  try {
    if (!process.stdin.isTTY) {
      const ttyPath = process.platform === 'win32' ? 'CON' : '/dev/tty';
      inputSource = fs.createReadStream(ttyPath);
    }
  } catch {
    return false;
  }

  const rl = readline.createInterface({
    input: inputSource,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`${query} (y/N) `, (answer: string) => {
      rl.close();
      const formatted = answer.trim().toLowerCase();
      resolve(formatted === 'y' || formatted === 'yes');
    });
  });
}
