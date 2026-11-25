import { describe, it, expect, afterEach, vi } from 'vitest'
import { fetchImage } from '../src/modules/mealie/mealie-reads'

const RID = '11111111-1111-4111-8111-111111111111'
const conn = { baseUrl: 'http://mealie.test' } as never

afterEach(() => vi.unstubAllGlobals())

describe('fetchImage', () => {
  it('maps a body that dies mid-read to 502 MealieUnavailable', async () => {
    const body = new ReadableStream({ pull(c) { c.error(new DOMException('aborted', 'AbortError')) } })
    const res = new Response(body, { status: 200, headers: { 'content-type': 'image/webp' } })
    vi.stubGlobal('fetch', vi.fn(async () => res))
    await expect(fetchImage(conn, RID, 'min')).rejects.toMatchObject({ name: 'MealieUnavailable', statusCode: 502 })
  })
})
