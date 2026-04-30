/**
 * Pure utility to split a raw artist string from Last.fm or YouTube
 * into an array of individual artist names based on commas.
 *
 * Example: "Jasmine Sandlas, Shashwat Sachdev" -> ["Jasmine Sandlas", "Shashwat Sachdev"]
 */
export function splitArtists(raw: string): string[] {
  if (!raw) return [];

  return (
    raw
      // split by comma OR ampersand
      .split(/,|&/)
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
      .reduce((acc: string[], current) => {
        // case-insensitive dedupe
        if (!acc.find((a) => a.toLowerCase() === current.toLowerCase())) {
          acc.push(current);
        }
        return acc;
      }, [])
  );
}
