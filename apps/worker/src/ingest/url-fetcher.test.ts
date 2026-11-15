import { describe, expect, it, vi } from 'vitest';
import { IngestError } from './errors.js';
import {
  decode,
  type FetchLike,
  guardedFetch,
  guardedLookup,
  isPublicAddress,
  type Resolver,
  UrlFetcher,
} from './url-fetcher.js';

const PUBLIC_V4 = '93.184.215.14';
const PUBLIC_V6 = '2606:2800:21f:cb07:6820:80da:af6b:8b2c';

/** Fake DNS: hostname → addresses. Unknown names fail like NXDOMAIN. No real DNS in tests. */
function fakeResolver(table: Record<string, string[]>): Resolver & { calls: string[] } {
  const calls: string[] = [];
  const resolver = (hostname: string) => {
    calls.push(hostname);
    const addresses = table[hostname];
    if (!addresses)
      return Promise.reject(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
    return Promise.resolve(
      addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
    );
  };
  return Object.assign(resolver, { calls });
}

function htmlResponse(body: string, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

/** Fake HTTP: URL → response factory. Records every requested URL. */
function fakeFetch(routes: Record<string, () => Response>): FetchLike & { urls: string[] } {
  const urls: string[] = [];
  const fetch: FetchLike = (url) => {
    urls.push(url);
    const route = routes[url];
    if (!route) return Promise.reject(new Error(`unexpected request to ${url}`));
    return Promise.resolve(route());
  };
  return Object.assign(fetch, { urls });
}

const resolver = fakeResolver({
  'example.com': [PUBLIC_V4, PUBLIC_V6],
  'www.example.com': [PUBLIC_V4],
  'internal.example.com': ['10.0.0.5'],
  'mixed.example.com': [PUBLIC_V4, '127.0.0.1'],
  'metadata.example.com': ['169.254.169.254'],
  'mapped.example.com': ['::ffff:127.0.0.1'],
  'ula.example.com': ['fd12:3456::1'],
});

function fetcherWith(routes: Record<string, () => Response>, options = {}) {
  const fetch = fakeFetch(routes);
  return { fetcher: new UrlFetcher({ resolver, fetch, ...options }), fetch };
}

/** Never answers; rejects once the request signal aborts. */
const hanging: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    if (init.signal.aborted) reject(init.signal.reason);
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof IngestError) return error.message;
    throw error;
  }
  throw new Error('expected an IngestError');
}

describe('isPublicAddress', () => {
  it.each([PUBLIC_V4, '8.8.8.8', '1.1.1.1', PUBLIC_V6, '2001:4860:4860::8888', '::ffff:8.8.8.8'])(
    'allows public %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '0.0.0.0',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // carrier-grade NAT
    '192.0.2.1', // documentation
    '198.18.0.1', // benchmarking
    '224.0.0.1', // multicast
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:7f00:1', // same, hex form
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '::127.0.0.1', // deprecated IPv4-compatible
    'fe80::1', // link-local
    'fd00:ec2::254', // unique local (AWS metadata over IPv6)
    'fc00::1',
    'ff02::1', // multicast
    '64:ff9b::7f00:1', // NAT64 to loopback
    '2002:7f00:1::1', // 6to4 to loopback
    '2001::1', // Teredo
    '2001:db8::1', // documentation
    'not-an-ip',
    '',
  ])('blocks %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe('UrlFetcher', () => {
  it('fetches an HTML page from a public host', async () => {
    const { fetcher, fetch } = fetcherWith({
      'https://example.com/post': () => htmlResponse('<p>Hällo</p>'),
    });
    await expect(fetcher.fetchPage('https://example.com/post')).resolves.toEqual({
      url: 'https://example.com/post',
      html: '<p>Hällo</p>',
    });
    expect(fetch.urls).toEqual(['https://example.com/post']);
  });

  it.each([
    ['ftp://example.com/file', /Only http and https/],
    ['file:///etc/passwd', /Only http and https/],
    ['https://user:pw@example.com/', /credentials/],
    ['https://example.com:22/', /standard web ports/],
    ['http://127.0.0.1/', /not allowed/],
    ['http://2130706433/', /not allowed/], // decimal form of 127.0.0.1
    ['http://0x7f.1/', /not allowed/],
    ['http://[::1]/', /not allowed/],
    ['http://[::ffff:127.0.0.1]/', /not allowed/],
    ['http://169.254.169.254/latest/meta-data/', /not allowed/],
    ['http://[fd00:ec2::254]/', /not allowed/],
    ['http://internal.example.com/', /not allowed/],
    ['http://mixed.example.com/', /not allowed/],
    ['http://metadata.example.com/', /not allowed/],
    ['http://mapped.example.com/', /not allowed/],
    ['http://ula.example.com/', /not allowed/],
    ['http://unknown.example.com/', /could not be resolved/],
    ['not a url', /not valid/],
  ])('refuses %s before any request', async (url, message) => {
    const { fetcher, fetch } = fetcherWith({});
    expect(await failure(fetcher.fetchPage(url))).toMatch(message);
    expect(fetch.urls).toEqual([]);
  });

  it('follows redirects and re-checks every hop', async () => {
    const { fetcher, fetch } = fetcherWith({
      'http://example.com/a': () => redirect('https://www.example.com/b', 301),
      'https://www.example.com/b': () => redirect('/c'),
      'https://www.example.com/c': () => htmlResponse('<p>ok</p>'),
    });
    await expect(fetcher.fetchPage('http://example.com/a')).resolves.toEqual({
      url: 'https://www.example.com/c',
      html: '<p>ok</p>',
    });
    expect(fetch.urls).toHaveLength(3);
  });

  it.each([
    'http://127.0.0.1/admin',
    'http://internal.example.com/',
    'http://[::ffff:169.254.169.254]/',
    'file:///etc/passwd',
    'gopher://example.com/',
  ])('blocks a redirect to %s', async (target) => {
    const { fetcher, fetch } = fetcherWith({
      'https://example.com/': () => redirect(target),
    });
    expect(await failure(fetcher.fetchPage('https://example.com/'))).toMatch(
      /not allowed|Only http and https/,
    );
    expect(fetch.urls).toEqual(['https://example.com/']);
  });

  it('limits the number of redirects', async () => {
    const { fetcher, fetch } = fetcherWith(
      { 'https://example.com/loop': () => redirect('https://example.com/loop') },
      { maxRedirects: 3 },
    );
    expect(await failure(fetcher.fetchPage('https://example.com/loop'))).toMatch(
      /redirected too many times/,
    );
    expect(fetch.urls).toHaveLength(4);
  });

  it('rejects redirects without a location', async () => {
    const { fetcher } = fetcherWith({
      'https://example.com/': () => new Response(null, { status: 302 }),
    });
    expect(await failure(fetcher.fetchPage('https://example.com/'))).toMatch(/without a target/);
  });

  it('rejects HTTP errors', async () => {
    const { fetcher } = fetcherWith({
      'https://example.com/missing': () => htmlResponse('nope', {}, 404),
    });
    expect(await failure(fetcher.fetchPage('https://example.com/missing'))).toMatch(/HTTP 404/);
  });

  it.each(['application/pdf', 'application/json', 'image/png', ''])(
    'rejects non-HTML content (%s)',
    async (type) => {
      const { fetcher } = fetcherWith({
        'https://example.com/file': () =>
          new Response('data', { headers: type ? { 'content-type': type } : {} }),
      });
      expect(await failure(fetcher.fetchPage('https://example.com/file'))).toMatch(
        /Only HTML pages/,
      );
    },
  );

  it('accepts XHTML', async () => {
    const { fetcher } = fetcherWith({
      'https://example.com/x': () =>
        new Response('<p>x</p>', { headers: { 'content-type': 'application/xhtml+xml' } }),
    });
    await expect(fetcher.fetchPage('https://example.com/x')).resolves.toMatchObject({
      html: '<p>x</p>',
    });
  });

  it('rejects pages above the size limit (declared or streamed)', async () => {
    const declared = fetcherWith(
      {
        'https://example.com/big': () => htmlResponse('x', { 'content-length': '2000' }),
      },
      { maxBytes: 1000 },
    );
    expect(await failure(declared.fetcher.fetchPage('https://example.com/big'))).toMatch(
      /larger than/,
    );

    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(400));
      },
    });
    const streamed = fetcherWith(
      {
        'https://example.com/stream': () =>
          new Response(endless, { headers: { 'content-type': 'text/html' } }),
      },
      { maxBytes: 1000 },
    );
    expect(await failure(streamed.fetcher.fetchPage('https://example.com/stream'))).toMatch(
      /larger than/,
    );
    expect(pulled).toBeLessThan(10);
  });

  it('times out slow pages', async () => {
    const fetcher = new UrlFetcher({ resolver, fetch: hanging, timeoutMs: 20 });
    expect(await failure(fetcher.fetchPage('https://example.com/slow'))).toMatch(/too long/);
  });

  it('propagates job cancellation instead of reporting a page error', async () => {
    const fetcher = new UrlFetcher({ resolver, fetch: hanging });
    const controller = new AbortController();
    const promise = fetcher.fetchPage('https://example.com/', controller.signal);
    controller.abort(new Error('job cancelled'));
    await expect(promise).rejects.toThrow('job cancelled');
  });
});

describe('decode', () => {
  it('uses the header charset, then <meta charset>, then UTF-8', () => {
    const latin1 = new Uint8Array([0x48, 0xe4, 0x6c, 0x6c, 0x6f]); // "Hällo" in ISO-8859-1
    expect(decode(latin1, 'text/html; charset=iso-8859-1')).toBe('Hällo');
    const meta = new TextEncoder().encode('<meta charset="windows-1252">');
    expect(decode(new Uint8Array([...meta, 0xe4]), 'text/html')).toBe(
      '<meta charset="windows-1252">ä',
    );
    expect(decode(new TextEncoder().encode('ä'), 'text/html; charset=bogus')).toBe('ä');
  });
});

function lookupResult(
  lookup: ReturnType<typeof guardedLookup>,
  hostname: string,
  options: { all?: boolean; family?: number },
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    lookup(hostname, options, (error, address, family) => {
      if (error) reject(error);
      else resolve(options.all ? address : { address, family });
    });
  });
}

describe('guardedLookup (connect-time check)', () => {
  it('returns only validated addresses in both callback shapes', async () => {
    const lookup = guardedLookup(resolver);
    await expect(lookupResult(lookup, 'example.com', { all: true })).resolves.toEqual([
      { address: PUBLIC_V4, family: 4 },
      { address: PUBLIC_V6, family: 6 },
    ]);
    await expect(lookupResult(lookup, 'example.com', { family: 6 })).resolves.toEqual({
      address: PUBLIC_V6,
      family: 6,
    });
    await expect(lookupResult(lookup, 'www.example.com', { family: 6 })).rejects.toThrow(
      /no usable address/,
    );
  });

  it('refuses private answers', async () => {
    const lookup = guardedLookup(resolver);
    await expect(lookupResult(lookup, 'mixed.example.com', { all: true })).rejects.toThrow(
      /not allowed/,
    );
  });

  it('defeats DNS rebinding: the connection re-resolves through the guard', async () => {
    // First answer (pre-check) is public, every later one points at loopback.
    let calls = 0;
    const rebinding = vi.fn<Resolver>((hostname: string) => {
      calls++;
      expect(hostname).toBe('rebind.example.com');
      return Promise.resolve([{ address: calls === 1 ? PUBLIC_V4 : '127.0.0.1', family: 4 }]);
    });
    // Real undici agent: the request must fail inside the guarded lookup, before any socket
    // is opened (nothing listens anywhere, and no real DNS is used).
    const fetcher = new UrlFetcher({ resolver: rebinding, fetch: guardedFetch(rebinding) });
    expect(await failure(fetcher.fetchPage('http://rebind.example.com/'))).toMatch(/not allowed/);
    expect(calls).toBe(2);
  });
});
