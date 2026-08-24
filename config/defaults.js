const DEFAULT_CONFIG = Object.freeze({
  mode: 'age',
  ageKeyPath: '~/.age/key.txt',
  sshKeyPath: '~/.ssh/id_ed25519',
  githubUsernames: [],
  recipientsFile: '.agerecipients'
});

const VALID_MODES = Object.freeze(['age', 'ssh']);

module.exports = {
  DEFAULT_CONFIG,
  VALID_MODES
};
