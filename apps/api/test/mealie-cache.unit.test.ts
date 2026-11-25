import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cacheGet, cacheClear, __resetMealieCache, __mealieCacheSize } from '../src/modules/mealie/mealie-cache'

describe('mealie cache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetMealieCache()
  })
  afterEach(() => vi.useRealTimers())

  it('serves a second read within the TTL without loading', async () => {
    const load = vi.fn(async () => 'a')
    expect(await cacheGet('h', 'plan', 'k', load)).toBe('a')
    expect(await cacheGet('h', 'plan', 'k', load)).toBe('a')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('reloads after the TTL', async () => {
    const load = vi.fn(async () => 'a')
    await cacheGet('h', 'plan', 'k', load)
    vi.advanceTimersByTime(30_001)
    await cacheGet('h', 'plan', 'k', load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('clears only the given kind for that household', async () => {
    const shop = vi.fn(async () => 's')
    const plan = vi.fn(async () => 'p')
    await cacheGet('h', 'shopping', 'k', shop)
    await cacheGet('h', 'plan', 'k', plan)
    cacheClear('h', 'shopping')
    await cacheGet('h', 'shopping', 'k', shop)
    await cacheGet('h', 'plan', 'k', plan)
    expect(shop).toHaveBeenCalledTimes(2)
    expect(plan).toHaveBeenCalledTimes(1)
  })

  it('clears every kind when none is given, leaving other households alone', async () => {
    const a = vi.fn(async () => 'a')
    const b = vi.fn(async () => 'b')
    await cacheGet('h1', 'plan', 'k', a)
    await cacheGet('h2', 'plan', 'k', b)
    cacheClear('h1')
    await cacheGet('h1', 'plan', 'k', a)
    await cacheGet('h2', 'plan', 'k', b)
    expect(a).toHaveBeenCalledTimes(2)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed load', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce('ok')
    await expect(cacheGet('h', 'plan', 'k', load)).rejects.toThrow('x')
    expect(await cacheGet('h', 'plan', 'k', load)).toBe('ok')
  })

  it('evicts expired entries instead of letting the map grow', async () => {
    await cacheGet('h', 'plan', 'a', async () => 1)
    await cacheGet('h', 'plan', 'b', async () => 2)
    vi.advanceTimersByTime(30_001)
    await cacheGet('h', 'plan', 'c', async () => 3)
    expect(__mealieCacheSize()).toBe(1)
    vi.advanceTimersByTime(30_001)
    await cacheGet('h', 'plan', 'c', async () => 4)
    expect(__mealieCacheSize()).toBe(1)
  })

  it('does not store a load that began before a clear of its kind', async () => {
    let finish!: (v: string) => void
    const slow = new Promise<string>((r) => { finish = r })
    const inflight = cacheGet('h', 'shopping', 'k', () => slow)
    cacheClear('h', 'shopping')
    finish('stale')
    expect(await inflight).toBe('stale')
    const fresh = vi.fn(async () => 'fresh')
    expect(await cacheGet('h', 'shopping', 'k', fresh)).toBe('fresh')
    expect(fresh).toHaveBeenCalledTimes(1)
  })

  it('still stores a load when only another kind was cleared', async () => {
    let finish!: (v: string) => void
    const slow = new Promise<string>((r) => { finish = r })
    const inflight = cacheGet('h', 'shopping', 'k', () => slow)
    cacheClear('h', 'plan')
    finish('v')
    await inflight
    const again = vi.fn(async () => 'x')
    expect(await cacheGet('h', 'shopping', 'k', again)).toBe('v')
    expect(again).not.toHaveBeenCalled()
  })

  it('a household-wide clear invalidates in-flight loads of every kind', async () => {
    let finish!: (v: string) => void
    const slow = new Promise<string>((r) => { finish = r })
    const inflight = cacheGet('h', 'plan', 'k', () => slow)
    cacheClear('h')
    finish('stale')
    await inflight
    const fresh = vi.fn(async () => 'fresh')
    expect(await cacheGet('h', 'plan', 'k', fresh)).toBe('fresh')
  })

  it('shares one load between identical reads already in flight', async () => {
    let finish!: (v: string) => void
    const load = vi.fn(() => new Promise<string>((r) => { finish = r }))
    const a = cacheGet('h', 'shopping', 'k', load)
    const b = cacheGet('h', 'shopping', 'k', load)
    finish('x')
    expect(await a).toBe('x')
    expect(await b).toBe('x')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not hand an in-flight pre-write load to a read that starts after the write', async () => {
    const finishers: ((v: string) => void)[] = []
    const load = vi.fn(() => new Promise<string>((r) => { finishers.push(r) }))
    const before = cacheGet('h', 'shopping', 'k', load)
    cacheClear('h', 'shopping')
    const after = cacheGet('h', 'shopping', 'k', load)
    expect(load).toHaveBeenCalledTimes(2)
    finishers[0]('old')
    finishers[1]('new')
    expect(await before).toBe('old')
    expect(await after).toBe('new')
  })

  it('keeps the shopping list at least as long as the kiosk poll interval', async () => {
    const load = vi.fn(async () => 'a')
    await cacheGet('h', 'shopping', 'k', load)
    vi.advanceTimersByTime(20_000)
    await cacheGet('h', 'shopping', 'k', load)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('retries after a load that failed', async () => {
    const load = vi.fn().mockImplementationOnce(() => { throw new Error('down') }).mockResolvedValueOnce('ok')
    await expect(cacheGet('h', 'plan', 'k', load)).rejects.toThrow('down')
    expect(await cacheGet('h', 'plan', 'k', load)).toBe('ok')
  })
})
