export const DEFAULT_CONFIG: Readonly<{
  encryptionKey: 'age';
  ageKeyPath: string;
  sshKeyPath: string;
  githubUsernames: string[];
  recipientsFile: string;
  enabled: boolean;
  paused: boolean;
  encryptionTrigger: 'manual' | 'commit';
}> = Object.freeze({
  encryptionKey: 'age',
  ageKeyPath: '~/.age/key.txt',
  sshKeyPath: '~/.ssh/id_ed25519',
  githubUsernames: [],
  recipientsFile: '.agerecipients',
  enabled: true,
  paused: false,
  encryptionTrigger: 'commit'
});

export const VALID_MODES = Object.freeze(['age', 'ssh'] as const);
export const VALID_ENCRYPTION_KEYS = VALID_MODES;

export type GitEnvShareEncryptionKey = (typeof VALID_MODES)[number];

export type GitEnvShareConfig = {
  encryptionKey?: GitEnvShareEncryptionKey | string;
  ageKeyPath?: string;
  sshKeyPath?: string;
  githubUsernames?: string[];
  githubUsers?: string[];
  githubUser?: string[] | string;
  recipientsFile?: string;
  enabled?: boolean;
  paused?: boolean;
  encryptionTrigger?: 'manual' | 'commit' | string;
  [key: string]: unknown;
};
