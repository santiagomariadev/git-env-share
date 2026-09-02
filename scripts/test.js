const { spawnSync } = require("child_process");

const remoteUrl = 'https://github.com/santiagomariadev/testrepository.git';
// const remoteUrl = 'git@github.com:santiagomariadev/testrepository.git';
// const remoteUrl = 'git@github.com:santiagomariadev/git-env-share.git';
try {
    const sshCheck = spawnSync('ssh', [
        '-T',
        '-o',
        'BatchMode=yes',
        remoteUrl.replace(/^(git@|https:\/\/)/, '').replace(/:.*/, '')
    ], { encoding: 'utf-8' });
    const sshOutput = (sshCheck.stdout || '') + (sshCheck.stderr || '');
    console.log(`SSH check output:\n${sshCheck.stdout}\n\n${sshCheck.status}\n\n${sshCheck.stderr}`);
} catch (error) {
    console.error('✕ SSH check failed. Ensure SSH is configured correctly and the remote repository is accessible.');
}