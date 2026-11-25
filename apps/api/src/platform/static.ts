import type http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { acceptsGzip, gzip, isCompressible } from './compress'

export interface StaticOptions {
  webRoot?: string
  mediaRoot?: string
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

const IMMUTABLE = 'public, max-age=31536000, immutable'
const NO_CACHE_FILES = new Set(['/index.html', '/sw.js', '/asset-manifest.json'])

// Only the calendar OAuth callbacks live under /auth on the api; /auth/callback is the
// web app's SSO landing route and must get index.html.
const API_AUTH_PATH = /^\/auth\/[^/]+\/calendar(\/|$)/

function isApiPath(p: string): boolean {
  return p === '/healthz' || p === '/api' || p.startsWith('/api/') || API_AUTH_PATH.test(p)
}

// Resolve a request path under root; null when it escapes the root or is malformed.
function within(root: string, rel: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(rel)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const base = resolve(root)
  const full = resolve(base, '.' + (decoded.startsWith('/') ? decoded : `/${decoded}`))
  return full.startsWith(base + sep) ? full : null
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

// Gzipped bodies of web files, keyed by path and invalidated by size+mtime. Media is
// images (never compressible), so this stays bounded by the size of the web build.
const gzCache = new Map<string, { etag: string; body: Buffer }>()

async function send(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string,
  cacheControl: string,
): Promise<void> {
  const info = await stat(path)
  const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`
  const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
  const compressible = isCompressible(type, info.size)
  const headers: http.OutgoingHttpHeaders = { 'content-type': type, 'cache-control': cacheControl, etag }
  if (compressible) headers.vary = 'Accept-Encoding'
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers)
    res.end()
    return
  }
  let body: Buffer
  if (compressible && acceptsGzip(req)) {
    let hit = gzCache.get(path)
    if (!hit || hit.etag !== etag) {
      hit = { etag, body: gzip(await readFile(path)) }
      gzCache.set(path, hit)
    }
    body = hit.body
    headers['content-encoding'] = 'gzip'
  } else {
    body = await readFile(path)
  }
  headers['content-length'] = body.byteLength
  res.writeHead(200, headers)
  res.end(req.method === 'HEAD' ? undefined : body)
}

function notFound(res: http.ServerResponse): void {
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: 'NotFound' }))
}

/** Serve the SPA and uploaded media. Resolves true when the response was handled. */
export async function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: StaticOptions,
): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  if (isApiPath(pathname)) return false

  if (pathname.startsWith('/media/')) {
    if (!opts.mediaRoot) return false
    const file = within(opts.mediaRoot, pathname.slice('/media'.length))
    if (!file || !(await isFile(file))) {
      notFound(res)
      return true
    }
    await send(req, res, file, IMMUTABLE)
    return true
  }

  if (!opts.webRoot) return false
  const file = within(opts.webRoot, pathname)
  if (file && (await isFile(file))) {
    const rel = '/' + file.slice(resolve(opts.webRoot).length + 1).split(sep).join('/')
    const cache = NO_CACHE_FILES.has(rel) ? 'no-cache' : rel.startsWith('/assets/') ? IMMUTABLE : 'public, max-age=3600'
    await send(req, res, file, cache)
    return true
  }
  // A stale tab asking for an old hashed bundle must get a 404, not index.html served as JS.
  if (pathname.startsWith('/assets/')) {
    notFound(res)
    return true
  }
  const index = resolve(opts.webRoot, 'index.html')
  if (!(await isFile(index))) return false
  await send(req, res, index, 'no-cache')
  return true
}
