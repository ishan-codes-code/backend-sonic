export function normalizeString(input: string): string {
  if (!input) return '';
  return input
    .toLowerCase()
    .trim()
    .replace(/\(.*?\)/g, '') // remove brackets
    .replace(/\[.*?\]/g, '')
    .replace(/[^a-z0-9\s]/g, '') // remove symbols
    .replace(/\s+/g, ' ')
    .trim();
}
