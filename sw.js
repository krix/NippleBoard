const CACHE_VERSION = 'nippleboard-v1';
const CACHE_NAME = `nippleboard-${CACHE_VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './sw.js',
  './manifest.webmanifest',
  './clips.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await cacheClipsFromManifest(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('nippleboard-') && k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'CACHE_CLIPS' && Array.isArray(msg.clips)) {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      await cacheClipList(cache, msg.clips);
    })());
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isClipsJson = url.pathname.endsWith('/clips.json');
  if (isClipsJson) {
    event.respondWith(networkFirstClipsJson(req));
    return;
  }

  if (req.headers.has('range')) {
    event.respondWith(rangeResponse(req));
    return;
  }

  event.respondWith(cacheFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function networkFirstClipsJson(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req, { cache: 'no-store' });
    if (res && res.ok) {
      cache.put(req, res.clone());
      // trigger background caching of any new clips
      const copy = res.clone();
      copy.json().then((data) => {
        if (Array.isArray(data)) {
          const files = data.map(c => c && c.file).filter(Boolean);
          cacheClipList(cache, files);
        }
      }).catch(() => {});
    }
    return res;
  } catch (e) {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    throw e;
  }
}

async function rangeResponse(req) {
  const cache = await caches.open(CACHE_NAME);
  const urlKey = new Request(req.url, { method: 'GET' });
  let res = await cache.match(urlKey, { ignoreSearch: true });
  if (!res) {
    res = await cache.match(req, { ignoreSearch: true });
  }
  if (!res) {
    try {
      // fetch full resource for caching, but caller asked for range; still better to fetch as-is
      const netRes = await fetch(req);
      // if server returned 206, try to also cache full version in background (best effort)
      if (netRes && netRes.status === 200) {
        cache.put(urlKey, netRes.clone());
      }
      return netRes;
    } catch (e) {
      return new Response('', { status: 504 });
    }
  }
  return createPartialResponse(req, res);
}

async function createPartialResponse(req, res) {
  if (res.status === 206) return res; // already partial
  const rangeHeader = req.headers.get('range');
  if (!rangeHeader) return res;
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
  if (!match) return new Response(buf, { status: 200, headers: res.headers });
  let start = match[1] === '' ? null : parseInt(match[1], 10);
  let end = match[2] === '' ? null : parseInt(match[2], 10);
  if (start === null && end !== null) { // suffix bytes
    start = Math.max(0, size - end);
    end = size - 1;
  } else {
    if (start === null || Number.isNaN(start)) start = 0;
    if (end === null || Number.isNaN(end) || end >= size) end = size - 1;
  }
  if (start > end || start >= size) {
    return new Response('', {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` }
    });
  }
  const chunk = buf.slice(start, end + 1);
  const headers = new Headers(res.headers);
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Length', String(chunk.byteLength));
  if (!headers.get('Content-Type')) headers.set('Content-Type', guessContentType(req.url));
  return new Response(chunk, { status: 206, statusText: 'Partial Content', headers });
}

function guessContentType(url) {
  const u = url.toLowerCase();
  if (u.endsWith('.mp4')) return 'video/mp4';
  if (u.endsWith('.webm')) return 'video/webm';
  if (u.endsWith('.mov')) return 'video/quicktime';
  return 'application/octet-stream';
}

async function cacheClipsFromManifest(cache) {
  try {
    let res = await cache.match('./clips.json');
    if (!res) res = await fetch('./clips.json');
    if (!res) return;
    const data = await res.clone().json();
    if (!Array.isArray(data)) return;
    const files = data.map(c => c && c.file).filter(Boolean);
    await cacheClipList(cache, files);
  } catch (e) {
    // ignore
  }
}

async function cacheClipList(cache, files) {
  const unique = [...new Set(files.filter(f => typeof f === 'string' && f.startsWith('clips/')))];
  const total = unique.length;
  let done = 0;
  if (total === 0) return;
  await broadcast({ type: 'CACHE_PROGRESS', done, total });
  for (const file of unique) {
    const url = './' + file.replace(/^\.\//, '');
    try {
      const existing = await cache.match(url);
      if (!existing) {
        const res = await fetch(url);
        if (res && res.ok) await cache.put(url, res.clone());
      }
    } catch (e) {
      await broadcast({ type: 'CACHE_ERROR', file: url });
    }
    done++;
    await broadcast({ type: 'CACHE_PROGRESS', done, total });
  }
  await broadcast({ type: 'CACHE_DONE', total });
}

async function broadcast(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of clients) client.postMessage(msg);
}
