import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'
import { gunzipSync } from 'node:zlib'
import type { AddressInfo } from 'node:net'
import { createHttpServer } from '../src/platform/http-server'

const INDEX = '<!doctype html><title>spa</title>'
const SECRET = 'TOP-SECRET'
const BIG_JS = 'export const x = "' + 'waffle '.repeat(2000) + '"\n'

let base: string
let server: http.Server
let tmp: string

const fakeApi = {
  run: async () => ({ statusCode: 404, body: '{"error":"NotFound"}' }),
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'waffled-static-'))
  const webRoot = join(tmp, 'web')
  const mediaRoot = join(tmp, 'media')
  mkdirSync(join(webRoot, 'assets'), { recursive: true })
  mkdirSync(join(mediaRoot, 'h1'), { recursive: true })
  writeFileSync(join(webRoot, 'index.html'), INDEX)
  writeFileSync(join(webRoot, 'assets', 'app.abc.js'), 'console.log(1)')
  writeFileSync(join(webRoot, 'sw.js'), 'self.skip()')
  writeFileSync(join(webRoot, 'assets', 'big.def.js'), BIG_JS)
  writeFileSync(join(mediaRoot, 'h1', 'a.jpg'), 'jpegbytes')
  writeFileSync(join(tmp, 'secrets.json'), SECRET)
  server = createHttpServer(fakeApi, { webRoot, mediaRoot })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
  rmSync(tmp, { recursive: true, force: true })
})

const get = (path: string, method = 'GET') => fetch(base + path, { method })

describe('static serving', () => {
  it('serves index.html at / with no-cache', async () => {
    const res = await get('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('cache-control')).toBe('no-cache')
  })

  it('falls back to index.html for SPA routes', async () => {
    const res = await get('/meals/recipe/123/cook')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(INDEX)
  })

  it('404s a missing hashed asset instead of serving index.html as JS', async () => {
    const res = await get('/assets/app.old.js')
    expect(res.status).toBe(404)
    expect(await res.text()).not.toBe(INDEX)
  })

  it('serves hashed assets as immutable', async () => {
    const res = await get('/assets/app.abc.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/javascript')
    expect(res.headers.get('cache-control')).toContain('immutable')
  })

  it('serves sw.js with no-cache', async () => {
    const res = await get('/sw.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-cache')
  })

  it('serves media immutable and 404s missing media', async () => {
    const ok = await get('/media/h1/a.jpg')
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('image/jpeg')
    expect(ok.headers.get('cache-control')).toContain('immutable')
    expect((await get('/media/h1/missing.jpg')).status).toBe(404)
  })

  it.each(['/media/../secrets.json', '/media/%2e%2e/secrets.json', '/%2e%2e/secrets.json', '/media/..%2fsecrets.json'])(
    'never leaks files outside the roots (%s)',
    async (p) => {
      const res = await get(p)
      expect([200, 404]).toContain(res.status)
      expect(await res.text()).not.toContain(SECRET)
    },
  )

  it('serves the web app at /auth/callback so SSO can finish', async () => {
    const res = await get('/auth/callback?code=handoff123')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(INDEX)
  })

  it('routes /api and /auth to the api, not index.html', async () => {
    for (const p of ['/api/nope', '/auth/microsoft/calendar/callback', '/auth/google/calendar/callback']) {
      const res = await get(p)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'NotFound' })
    }
  })

  it('HEAD / returns an empty body', async () => {
    const res = await get('/', 'HEAD')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })
})

function raw(path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolveP, reject) => {
    const req = http.request(base + path, { headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolveP({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('static compression and validators', () => {
  it('gzips a compressible asset when the client accepts it', async () => {
    const res = await raw('/assets/big.def.js', { 'accept-encoding': 'gzip, br' })
    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBe('gzip')
    expect(res.headers['vary']).toMatch(/accept-encoding/i)
    expect(res.body.length).toBeLessThan(BIG_JS.length / 4)
    expect(gunzipSync(res.body).toString()).toBe(BIG_JS)
  })

  it('sends it plain to a client that does not accept gzip, and never gzips images', async () => {
    const plain = await raw('/assets/big.def.js')
    expect(plain.headers['content-encoding']).toBeUndefined()
    expect(plain.body.toString()).toBe(BIG_JS)
    const img = await raw('/media/h1/a.jpg', { 'accept-encoding': 'gzip' })
    expect(img.headers['content-encoding']).toBeUndefined()
  })

  it('answers a matching If-None-Match with 304', async () => {
    const first = await raw('/index.html')
    const etag = first.headers['etag']
    expect(etag).toBeTruthy()
    const again = await raw('/index.html', { 'if-none-match': String(etag) })
    expect(again.status).toBe(304)
    expect(again.body.length).toBe(0)
  })
})
