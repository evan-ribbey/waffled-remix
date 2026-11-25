// Small in-process TTL cache so a kiosk polling Mealie doesn't hammer it. Keyed per household.
export type CacheKind = 'plan' | 'recipes' | 'recipe' | 'shopping'

const TTL_MS: Record<CacheKind, number> = { plan: 30_000, recipes: 60_000, recipe: 300_000, shopping: 25_000 }

interface Entry {
  expires: number
  value: unknown
}

const store = new Map<string, Entry>()
// Loads in progress, so concurrent identical reads (several kiosks, two cards) share one call.
const inflight = new Map<string, { gen: number; promise: Promise<unknown> }>()
// Bumped by cacheClear so a load that began before a write can't store its pre-write result.
const generations = new Map<string, number>()
const genKey = (householdId: string, kind: CacheKind) => `${householdId}|${kind}`
const KINDS: CacheKind[] = ['plan', 'recipes', 'recipe', 'shopping']
const keyOf = (householdId: string, kind: CacheKind, key: string) => `${householdId}|${kind}|${key}`

// Keys embed search/page/range, so without a sweep the map only ever grows.
function sweepExpired(householdId: string): void {
  const now = Date.now()
  const prefix = `${householdId}|`
  for (const [k, e] of store) if (e.expires <= now && k.startsWith(prefix)) store.delete(k)
}

export async function cacheGet<T>(householdId: string, kind: CacheKind, key: string, load: () => Promise<T>): Promise<T> {
  const k = keyOf(householdId, kind, key)
  const hit = store.get(k)
  if (hit && hit.expires > Date.now()) return hit.value as T
  if (hit) store.delete(k)
  const gen = generations.get(genKey(householdId, kind)) ?? 0
  const pending = inflight.get(k)
  if (pending && pending.gen === gen) return pending.promise as Promise<T>
  const entry: { gen: number; promise: Promise<unknown> } = { gen, promise: Promise.resolve() }
  const run = async (): Promise<T> => {
    const value = await load()
    if ((generations.get(genKey(householdId, kind)) ?? 0) === gen) {
      sweepExpired(householdId)
      store.set(k, { expires: Date.now() + TTL_MS[kind], value })
    }
    return value
  }
  const promise = run()
  entry.promise = promise
  inflight.set(k, entry)
  const done = () => { if (inflight.get(k) === entry) inflight.delete(k) }
  promise.then(done, done)
  return promise
}

export function cacheClear(householdId: string, kind?: CacheKind): void {
  for (const kd of kind ? [kind] : KINDS) generations.set(genKey(householdId, kd), (generations.get(genKey(householdId, kd)) ?? 0) + 1)
  const prefix = kind ? `${householdId}|${kind}|` : `${householdId}|`
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k)
}

export function __resetMealieCache(): void {
  store.clear()
  generations.clear()
  inflight.clear()
}

export const __mealieCacheSize = (): number => store.size
