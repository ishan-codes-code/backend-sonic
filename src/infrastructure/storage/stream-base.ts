/**
 * Local-mode stream base URL derivation.
 *
 * In local storage mode the API serves audio itself at
 * `<API base>/stream/<youtubeId>`, so every play response must embed an API
 * base URL the phone can actually reach (a LAN address or a tunnel address).
 * There is deliberately no configured base URL: the server derives it
 * per request from the same request the phone used to reach the API.
 *
 * Derivation:
 * - Host: first entry of X-Forwarded-Host when present, else the Host
 *   header. Strictly validated (hostname/IP with optional port only).
 * - Scheme: X-Forwarded-Proto when it is exactly http/https (this is how
 *   proxies and tunnels report the outer HTTPS connection), else the direct
 *   connection protocol.
 *
 * Why this is safe against token redirection: the derived URL is returned
 * only to the requester that supplied those headers, and absolute local
 * stream URLs are never cached or shared across requests (playlist and
 * stream-URL caches store metadata only). A requester can only redirect its
 * own playback token to a host it named itself; it cannot influence any
 * other client's URLs. Validation additionally rejects header-injection
 * shapes (credentials, paths, whitespace). Forwarded headers are honored
 * only as plain first-entry values, never as trusted proxy chains.
 *
 * Localhost is never assumed: it appears only when the client itself reached
 * the API through localhost, in which case echoing it back is correct for
 * that client.
 */

const MAX_HOST_LENGTH = 253;

// Hostname or IPv4 with optional port, or bracketed IPv6 with optional port.
// No userinfo, path, query, or whitespace is allowed.
const HOST_PATTERN =
  /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::\d{1,5})?$/;

export interface StreamBaseRequest {
  headers: Record<string, string | string[] | undefined>;
  protocol: string;
}

function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function firstListEntry(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const entry = value.split(',')[0]?.trim();
  return entry && entry.length > 0 ? entry : undefined;
}

export function isValidStreamHost(host: string): boolean {
  if (host.length === 0 || host.length > MAX_HOST_LENGTH) return false;
  if (!HOST_PATTERN.test(host)) return false;
  const portMatch = /:(\d{1,5})$/.exec(host);
  if (portMatch && !host.startsWith('[')) {
    const port = Number(portMatch[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  }
  if (host.startsWith('[')) {
    const bracketEnd = host.indexOf(']');
    if (bracketEnd === -1) return false;
    const rest = host.slice(bracketEnd + 1);
    if (rest !== '' && !/^:\d{1,5}$/.test(rest)) return false;
    if (rest !== '') {
      const port = Number(rest.slice(1));
      if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
    }
  }
  return true;
}

/**
 * Derive the absolute API base URL for local stream URLs from one request.
 * Throws a descriptive Error when no safe host is available; callers map it
 * to a client error without echoing header values.
 */
export function getLocalStreamBaseUrl(req: StreamBaseRequest): string {
  const forwardedProto = firstListEntry(
    firstHeaderValue(req.headers['x-forwarded-proto']),
  )?.toLowerCase();
  const scheme =
    forwardedProto === 'http' || forwardedProto === 'https'
      ? forwardedProto
      : req.protocol === 'https'
        ? 'https'
        : 'http';

  const forwardedHost = firstListEntry(
    firstHeaderValue(req.headers['x-forwarded-host']),
  );
  const directHost = firstHeaderValue(req.headers['host'])?.trim();
  const host =
    forwardedHost && forwardedHost.length > 0 ? forwardedHost : directHost;

  if (!host || !isValidStreamHost(host)) {
    throw new Error(
      'Cannot determine a safe stream base URL from the request host.',
    );
  }
  return `${scheme}://${host}`;
}
