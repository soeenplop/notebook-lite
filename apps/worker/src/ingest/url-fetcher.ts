import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as undiciFetch } from 'undici';
import { IngestError } from './errors.js';

/**
 * The only way the worker fetches user-supplied URLs (SSRF guard):
 *  - http/https only, no credentials, standard web ports only;
 *  - every hostname is resolved and *all* addresses must be public unicast (no private,
 *    loopback, link-local/metadata, CGNAT, multicast, reserved, IPv4-mapped/-compatible,
 *    NAT64/6to4/Teredo ranges); IP literals are checked the same way;
 *  - the connection itself resolves through the same guard (connect-time lookup), so a DNS
 *    answer that changes after the check (rebinding) cannot reach an internal address;
 *  - redirects are followed manually and every hop is re-checked; at most `maxRedirects`;
 *  - one overall timeout, a response size cap (streamed) and HTML content types only.
 */

export interface ResolvedAddress {
  address: string;
  family: number;
}

/** Resolves a hostname to all of its addresses (tests pass a fake; no real DNS). */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface FetchResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
}

export type FetchLike = (
  url: string,
  init: { redirect: 'manual'; signal: AbortSignal; headers: Record<string, string> },
) => Promise<FetchResponseLike>;

export interface UrlFetcherOptions {
  resolver?: Resolver;
  /** Performs the HTTP request. Defaults to undici with the guarded connect-time lookup. */
  fetch?: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface FetchedPage {
  /** URL after redirects. */
  url: string;
  html: string;
}

export const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const DEFAULTS = { timeoutMs: 20_000, maxBytes: 5 * 1024 * 1024, maxRedirects: 5 };
const USER_AGENT = 'Mozilla/5.0 (compatible; NotebookLite/1.0; +source-ingestion)';

/** True only for public unicast addresses. Anything unparsable counts as not public. */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let ip = ipaddr.parse(address);
  if (ip instanceof ipaddr.IPv6) {
    if (ip.isIPv4MappedAddress()) {
      ip = ip.toIPv4Address();
    } else if (ip.parts.slice(0, 6).every((part) => part === 0)) {
      // ::/96 (unspecified, loopback, deprecated IPv4-compatible addresses)
      return false;
    }
  }
  return ip.range() === 'unicast';
}

const defaultResolver: Resolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/** Hostname without the brackets URL keeps around IPv6 literals. */
function bareHostname(url: URL): string {
  return url.hostname.replace(/^\[(.*)\]$/, '$1');
}

/** Rejects URLs the worker must never request, before any network access. */
export function assertFetchableUrl(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new IngestError('Only http and https URLs are supported.');
  }
  if (url.username || url.password) {
    throw new IngestError('URLs with credentials are not supported.');
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new IngestError('Only standard web ports (80, 443, 8080, 8443) are supported.');
  }
  const host = bareHostname(url);
  if (ipaddr.isValid(host) && !isPublicAddress(host)) throw blockedAddress();
}

/** Resolves a hostname and requires every address to be public. */
export async function resolvePublicAddresses(
  hostname: string,
  resolver: Resolver,
): Promise<ResolvedAddress[]> {
  if (ipaddr.isValid(hostname)) {
    if (!isPublicAddress(hostname)) throw blockedAddress();
    return [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv6' ? 6 : 4 }];
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolver(hostname);
  } catch (cause) {
    throw new IngestError(`The address ${hostname} could not be resolved.`, { cause });
  }
  if (addresses.length === 0) {
    throw new IngestError(`The address ${hostname} could not be resolved.`);
  }
  if (!addresses.every((entry) => isPublicAddress(entry.address))) throw blockedAddress();
  return addresses;
}

/**
 * A `net.connect` lookup that only ever hands out public addresses. Supports both callback
 * shapes (`all: true` with Node's happy-eyeballs, and the single-address form).
 */
export function guardedLookup(resolver: Resolver): LookupFunction {
  return (hostname, options, callback) => {
    void (async () => {
      let addresses: ResolvedAddress[];
      try {
        addresses = await resolvePublicAddresses(hostname, resolver);
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)), '', 4);
        return;
      }
      const wanted =
        options.family === 4 || options.family === 6
          ? addresses.filter((entry) => entry.family === options.family)
          : addresses;
      const first = wanted[0];
      if (!first) {
        const error = Object.assign(new Error(`no usable address for ${hostname}`), {
          code: 'ENOTFOUND',
        });
        callback(error, '', 4);
      } else if (options.all) {
        callback(null, wanted);
      } else {
        callback(null, first.address, first.family);
      }
    })();
  };
}

/** undici-backed HTTP client whose connections resolve through {@link guardedLookup}. */
export function guardedFetch(resolver: Resolver): FetchLike {
  // Redirects are handled by UrlFetcher (`redirect: 'manual'`), never by the agent.
  const agent = new Agent({ connect: { lookup: guardedLookup(resolver), timeout: 10_000 } });
  return async (url, init) => {
    const response = await undiciFetch(url, { ...init, dispatcher: agent });
    return {
      status: response.status,
      headers: response.headers,
      // undici's stream type differs nominally from the DOM lib's; the runtime object is the same.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      body: response.body as ReadableStream<Uint8Array> | null,
    };
  };
}

export class UrlFetcher {
  readonly #resolver: Resolver;
  readonly #fetch: FetchLike;
  readonly #opts: typeof DEFAULTS;

  constructor(options: UrlFetcherOptions = {}) {
    this.#resolver = options.resolver ?? defaultResolver;
    this.#fetch = options.fetch ?? guardedFetch(this.#resolver);
    this.#opts = {
      timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
      maxBytes: options.maxBytes ?? DEFAULTS.maxBytes,
      maxRedirects: options.maxRedirects ?? DEFAULTS.maxRedirects,
    };
  }

  /** Fetches an HTML page. Throws {@link IngestError} with a user-readable message. */
  async fetchPage(input: string, signal?: AbortSignal): Promise<FetchedPage> {
    const url = parseUrl(input);
    const timeout = AbortSignal.timeout(this.#opts.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    return this.#follow(url, 0, { signal, timeout, combined });
  }

  /** Requests `url`; on a redirect, re-validates the target and recurses (one call per hop). */
  async #follow(url: URL, hop: number, signals: Signals): Promise<FetchedPage> {
    signals.signal?.throwIfAborted();
    assertFetchableUrl(url);
    await resolvePublicAddresses(bareHostname(url), this.#resolver);

    let response: FetchResponseLike;
    try {
      response = await this.#fetch(url.href, {
        redirect: 'manual',
        signal: signals.combined,
        headers: { accept: 'text/html,application/xhtml+xml;q=0.9', 'user-agent': USER_AGENT },
      });
    } catch (cause) {
      throw loadError(cause, signals);
    }

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) {
        throw new IngestError(`The page redirected without a target (HTTP ${response.status}).`);
      }
      if (hop >= this.#opts.maxRedirects) {
        throw new IngestError('The page redirected too many times.');
      }
      return this.#follow(parseUrl(location, url), hop + 1, signals);
    }
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel();
      throw new IngestError(`The page could not be loaded (HTTP ${response.status}).`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!HTML_TYPES.has(mediaType)) {
      await response.body?.cancel();
      throw new IngestError(
        `Only HTML pages are supported (the URL returned ${mediaType || 'an unknown type'}).`,
      );
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > this.#opts.maxBytes) {
      await response.body?.cancel();
      throw tooLarge(this.#opts.maxBytes);
    }

    let bytes: Uint8Array;
    try {
      bytes = await readLimited(response.body, this.#opts.maxBytes);
    } catch (cause) {
      throw loadError(cause, signals);
    }
    return { url: url.href, html: decode(bytes, contentType) };
  }
}

interface Signals {
  /** The caller's signal (job cancellation): propagated as-is. */
  signal: AbortSignal | undefined;
  timeout: AbortSignal;
  combined: AbortSignal;
}

/** Maps a request/stream failure to a user-readable error (cancellation passes through). */
function loadError(cause: unknown, signals: Signals): unknown {
  if (signals.signal?.aborted) return cause;
  if (cause instanceof IngestError) return cause;
  if (signals.timeout.aborted) {
    return new IngestError('The page took too long to respond.', { cause });
  }
  // undici wraps connect errors (e.g. a refused address from the guarded lookup) as `cause`.
  const inner = cause instanceof Error ? cause.cause : undefined;
  if (inner instanceof IngestError) return inner;
  return new IngestError('The page could not be loaded.', { cause });
}

function parseUrl(value: string, base?: URL): URL {
  const url = URL.parse(value, base);
  if (!url) throw new IngestError('The URL is not valid.');
  return url;
}

function blockedAddress(): IngestError {
  return new IngestError('This address is not allowed (private or internal network).');
}

function tooLarge(maxBytes: number): IngestError {
  return new IngestError(`The page is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
}

/** Reads a body stream, aborting once it exceeds `maxBytes`. */
async function readLimited(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    // Streaming read: each chunk depends on the previous one.
    // oxlint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // oxlint-disable-next-line no-await-in-loop
      await reader.cancel();
      throw tooLarge(maxBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Decodes with the charset from the header or a `<meta charset>`, falling back to UTF-8. */
export function decode(bytes: Uint8Array, contentType: string): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  for (const label of [fromHeader, fromMeta, 'utf-8']) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // unknown label: try the next candidate
    }
  }
  return new TextDecoder().decode(bytes);
}
