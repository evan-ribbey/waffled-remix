import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TrackerHistory } from './TrackerHistory'

const h = vi.hoisted(() => ({
  api: { entries: vi.fn(), updateEntry: vi.fn(), deleteEntry: vi.fn() },
  refetch: [] as (() => void)[],
  live: [] as (() => void)[],
}))
vi.mock('../../lib/api/trackers', () => ({ trackersApi: h.api }))
vi.mock('../../lib/api/bus', () => ({
  useRefetchOn: (_t: string[], fn: () => void) => { h.refetch.push(fn) },
  useLiveRefresh: (fn: () => void) => { h.live.push(fn) },
  emit: () => {},
}))
vi.mock('../../lib/api/persons', () => ({
  usePersons: () => ({ persons: [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Ben' }] }),
}))

const tracker = { id: 't1', title: 'Tylenol', emoji: null, askPerson: true, sortOrder: 0, archivedAt: null, lastEntry: null }
const entry = (id: string, personName: string | null = null) =>
  ({ id, trackerId: 't1', occurredAt: '2026-11-23T20:15:00.000Z', personId: personName ? 'p1' : null, personName, loggedBy: 'me', loggedByName: `By-${id}`, note: null })

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => {
  Object.values(h.api).forEach((f) => f.mockReset())
  h.refetch = []
  h.live = []
})

const renderIt = () => render(<TrackerHistory tracker={tracker} tz="America/Chicago" onBack={() => {}} />)

describe('TrackerHistory', () => {
  it('keeps every loaded page when the list refreshes after an edit', async () => {
    h.api.entries
      .mockResolvedValueOnce({ entries: [entry('a'), entry('b')], nextBefore: 'cur1' })
      .mockResolvedValueOnce({ entries: [entry('c')], nextBefore: null })
    renderIt()
    fireEvent.click(await screen.findByText('Load more'))
    expect(await screen.findByText('logged by By-c')).toBeInTheDocument()

    h.api.entries.mockResolvedValueOnce({ entries: [entry('a'), entry('b'), entry('c')], nextBefore: null })
    act(() => h.refetch.at(-1)!())
    await waitFor(() => expect(h.api.entries).toHaveBeenCalledTimes(3))
    expect(h.api.entries.mock.calls[2][1].before).toBeUndefined()
    expect(h.api.entries.mock.calls[2][1].limit).toBeGreaterThanOrEqual(3)
    expect(await screen.findByText('logged by By-c')).toBeInTheDocument()
  })

  it('drops a Load more that returns after the filter changed', async () => {
    const late = deferred<{ entries: unknown[]; nextBefore: string | null }>()
    h.api.entries
      .mockResolvedValueOnce({ entries: [entry('a')], nextBefore: 'cur1' })
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce({ entries: [entry('ben1')], nextBefore: null })
    renderIt()
    fireEvent.click(await screen.findByText('Load more'))
    fireEvent.change(screen.getByLabelText('Filter by person'), { target: { value: 'p2' } })
    expect(await screen.findByText('logged by By-ben1')).toBeInTheDocument()

    await act(async () => { late.resolve({ entries: [entry('everyone2')], nextBefore: null }) })
    expect(screen.queryByText('logged by By-everyone2')).toBeNull()
  })

  it('polls for entries logged on other devices', async () => {
    h.api.entries.mockResolvedValue({ entries: [], nextBefore: null })
    renderIt()
    await screen.findByText('Nothing logged yet.')
    expect(h.live.length).toBeGreaterThan(0)
  })
})
