export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function splitTrimmedNonEmptyLines(content: string): string[] {
  return normalizeLineEndings(content)
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
