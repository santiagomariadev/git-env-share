const fs = require('fs');
const readline = require('readline');

async function askQuestion(query) {
  let inputSource = process.stdin;
  
  // Re-attach to the TTY if running inside a non-interactive Git hook environment
  try {
    if (!process.stdin.isTTY) {
      const ttyPath = process.platform === 'win32' ? 'CON' : '/dev/tty';
      inputSource = fs.createReadStream(ttyPath);
    }
  } catch (e) {
    // If no terminal is available (e.g., GUI Git client like SourceTree/Tower), skip prompt
    return false;
  }

  const rl = readline.createInterface({
    input: inputSource,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${query} (y/N) `, (answer) => {
      rl.close();
      const formatted = answer.trim().toLowerCase();
      resolve(formatted === 'y' || formatted === 'yes');
    });
  });
}

module.exports = askQuestion;
