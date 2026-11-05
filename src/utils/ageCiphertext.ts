const AGE_BINARY_HEADER = 'age-encryption.org/v1';
const AGE_ARMORED_HEADER = '-----BEGIN AGE ENCRYPTED FILE-----';

export function isAgeCiphertext(content: Buffer): boolean {
  if (!content || content.length === 0) {
    return false;
  }

  const prefix = content.subarray(0, 128).toString('utf-8');
  return prefix.startsWith(AGE_BINARY_HEADER) || prefix.startsWith(AGE_ARMORED_HEADER);
}

export function describeAgeCiphertextHeaders(): string {
  return `${AGE_BINARY_HEADER} or ${AGE_ARMORED_HEADER}`;
}
