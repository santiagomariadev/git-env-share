export const ENCRYPTION_KEYS = {
  AGE: 'age',
  SSH: 'ssh'
} as const;

export const ENCRYPTION_TRIGGERS = {
  COMMIT: 'commit',
  MANUAL: 'manual'
} as const;

export const VALID_ENCRYPTION_KEYS = Object.freeze(Object.values(ENCRYPTION_KEYS));
export const VALID_ENCRYPTION_TRIGGERS = Object.freeze(Object.values(ENCRYPTION_TRIGGERS));
export const VALID_MODES = VALID_ENCRYPTION_KEYS;

export type GitEnvShareEncryptionKey = (typeof ENCRYPTION_KEYS)[keyof typeof ENCRYPTION_KEYS];
export type GitEnvShareEncryptionTrigger = (typeof ENCRYPTION_TRIGGERS)[keyof typeof ENCRYPTION_TRIGGERS];

export const DEFAULT_CONFIG: Readonly<{
  encryptionKey: GitEnvShareEncryptionKey;
  ageKeyPath: string;
  sshKeyPath: string;
  githubUsernames: string[];
  recipientsFile: string;
  enabled: boolean;
  paused: boolean;
  encryptionTrigger: GitEnvShareEncryptionTrigger;
}> = Object.freeze({
  encryptionKey: ENCRYPTION_KEYS.AGE,
  ageKeyPath: '~/.age/key.txt',
  sshKeyPath: '~/.ssh/id_ed25519',
  githubUsernames: [],
  recipientsFile: '.agerecipients',
  enabled: true,
  paused: false,
  encryptionTrigger: ENCRYPTION_TRIGGERS.COMMIT
});

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
  encryptionTrigger?: GitEnvShareEncryptionTrigger | string;
  [key: string]: unknown;
};
