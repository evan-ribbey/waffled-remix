import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mealieFetch, MealieError } from '../src/modules/mealie/mealie-client'

let base = ''
let server: http.Server
const seen: { path: string; auth: string | undefined }[] = []

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ path: req.url ?? '', auth: req.headers.authorization })
    if (req.url === '/moved') { res.writeHead(302, { location: 'https://food.example.com/api/x' }); res.end(); return }
    if (req.url === '/huge') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ blob: 'x'.repeat(6 * 1024 * 1024) }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

describe('mealieFetch', () => {
  it('does not follow a redirect, and names where it pointed', async () => {
    const err = await mealieFetch<never>({ baseUrl: base, token: 't' }, '/moved').catch((e: unknown) => e as MealieError)
    expect(err).toBeInstanceOf(MealieError)
    expect(err.name).toBe('MealieRedirected')
    expect(err.message).toContain('https://food.example.com')
    expect(seen.filter((s) => s.path === '/api/x')).toHaveLength(0)
  })

  it('refuses a body over the size cap', async () => {
    const err = await mealieFetch<never>({ baseUrl: base }, '/huge').catch((e: unknown) => e as MealieError)
    expect(err.name).toBe('MealieUnavailable')
  })

  it('still parses a normal JSON body', async () => {
    expect(await mealieFetch({ baseUrl: base }, '/ok')).toEqual({ ok: true })
  })
})
