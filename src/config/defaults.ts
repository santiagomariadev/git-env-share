export const DEFAULT_CONFIG: Readonly<{
  mode: 'age';
  ageKeyPath: string;
  sshKeyPath: string;
  githubUsernames: string[];
  recipientsFile: string;
}> = Object.freeze({
  mode: 'age',
  ageKeyPath: '~/.age/key.txt',
  sshKeyPath: '~/.ssh/id_ed25519',
  githubUsernames: [],
  recipientsFile: '.agerecipients'
});

export const VALID_MODES = Object.freeze(['age', 'ssh'] as const);

export type GitEnvShareMode = (typeof VALID_MODES)[number];

export type GitEnvShareConfig = {
  mode: GitEnvShareMode | string;
  ageKeyPath?: string;
  sshKeyPath?: string;
  githubUsernames?: string[];
  githubUsers?: string[];
  githubUser?: string[] | string;
  recipientsFile?: string;
  [key: string]: unknown;
};
