import { useCallback, useEffect, useRef, useState } from 'react'
import { trackersApi, type Tracker, type TrackerEntry } from '../../lib/api/trackers'
import { useLiveRefresh, useRefetchOn } from '../../lib/api/bus'
import { usePersons } from '../../lib/api/persons'
import { formatEntryTime, isoToZonedInput, zonedInputToIso } from '../../lib/trackers-format'
import { ConfirmDialog } from './ConfirmDialog'

const PAGE = 50
const MAX_PAGE = 200

export function TrackerHistory({ tracker, tz, onBack }: { tracker: Tracker; tz: string; onBack: () => void }) {
  const { persons } = usePersons()
  const [personId, setPersonId] = useState('')
  const [entries, setEntries] = useState<TrackerEntry[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const [editing, setEditing] = useState<{ entry: TrackerEntry; value: string } | null>(null)
  const [deleting, setDeleting] = useState<TrackerEntry | null>(null)
  const refresh = useCallback(() => setNonce((n) => n + 1), [])
  useRefetchOn(['trackers'], refresh)
  useLiveRefresh(refresh)
  // Bumped on every reload so a Load more that started before it is discarded.
  const gen = useRef(0)
  const loaded = useRef(0)
  const filterKey = `${tracker.id}|${personId}`
  const lastFilter = useRef(filterKey)

  useEffect(() => {
    let alive = true
    const g = ++gen.current
    // A refresh of the same filter re-reads every row already shown, not just page 1.
    const sameFilter = lastFilter.current === filterKey
    lastFilter.current = filterKey
    const limit = sameFilter && loaded.current > 0 ? Math.min(Math.max(loaded.current, PAGE), MAX_PAGE) : undefined
    trackersApi.entries(tracker.id, { personId: personId || undefined, before: undefined, limit })
      .then((d) => {
        if (!alive || g !== gen.current) return
        setEntries(d.entries); setNext(d.nextBefore); setError(false); loaded.current = d.entries.length
      })
      .catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [tracker.id, personId, nonce, filterKey])

  async function loadMore() {
    if (!next) return
    const g = gen.current
    try {
      const d = await trackersApi.entries(tracker.id, { personId: personId || undefined, before: next })
      if (g !== gen.current) return
      setEntries((cur) => {
        const merged = [...(cur ?? []), ...d.entries]
        loaded.current = merged.length
        return merged
      })
      setNext(d.nextBefore)
    } catch { if (g === gen.current) setError(true) }
  }

  async function saveEdit() {
    if (!editing) return
    const iso = zonedInputToIso(editing.value, tz)
    if (!iso) { setEditError('Enter a valid date and time.'); return }
    try {
      await trackersApi.updateEntry(editing.entry.id, { occurredAt: iso })
      setEditing(null)
    } catch {
      setEditError("Couldn't save that — try again.")
    }
  }

  async function confirmDelete(entry: TrackerEntry) {
    try {
      await trackersApi.deleteEntry(entry.id)
      setActionError(null)
    } catch {
      setActionError("Couldn't delete that entry — try again.")
    }
    setDeleting(null)
  }

  return (
    <div style={{ padding: '0 30px 30px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button type="button" className="btn btn-ghost" onClick={onBack}>← Back</button>
        <div className="wf-serif" style={{ fontSize: 20, fontWeight: 600 }}>{tracker.emoji ? `${tracker.emoji} ` : ''}{tracker.title}</div>
        {tracker.askPerson && (
          <select className="sel" style={{ marginLeft: 'auto' }} aria-label="Filter by person" value={personId} onChange={(e) => { setPersonId(e.target.value); setEntries(null) }}>
            <option value="">Everyone</option>
            {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      </div>
      {actionError && <div role="alert" className="tiny" style={{ color: 'var(--primary)', fontWeight: 700, marginBottom: 8 }}>{actionError}</div>}
      {error && <div className="muted">Couldn't load history — try again.</div>}
      {!error && entries === null && <div className="muted">Loading…</div>}
      {entries?.length === 0 && <div className="muted">Nothing logged yet.</div>}
      {entries?.map((e) => (
        <div key={e.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 8 }}>
          <span style={{ fontWeight: 600 }}>{formatEntryTime(e.occurredAt, tz)}</span>
          {e.personId && <span>{e.personName ?? 'Someone'}</span>}
          {e.loggedByName && <span className="tiny muted">logged by {e.loggedByName}</span>}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button type="button" className="pill" aria-label="Edit entry time" onClick={() => { setEditError(null); setEditing({ entry: e, value: isoToZonedInput(e.occurredAt, tz) }) }}>Edit</button>
            <button type="button" className="pill" aria-label="Delete entry" onClick={() => setDeleting(e)}>Delete</button>
          </span>
        </div>
      ))}
      {next && <button type="button" className="btn btn-ghost" onClick={loadMore}>Load more</button>}

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <form className="modal-card" onClick={(ev) => ev.stopPropagation()} onSubmit={(ev) => { ev.preventDefault(); void saveEdit() }} style={{ maxWidth: 360 }}>
            <button type="button" className="modal-close" aria-label="Close" onClick={() => setEditing(null)}>×</button>
            <div className="wf-serif" style={{ fontSize: 22, fontWeight: 600, marginBottom: 14 }}>Edit time</div>
            {editError && <div role="alert" className="tiny" style={{ color: 'var(--primary)', fontWeight: 700, marginBottom: 10 }}>{editError}</div>}
            <label className="field">
              <span>When</span>
              <input type="datetime-local" value={editing.value} onChange={(ev) => setEditing({ ...editing, value: ev.target.value })} />
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={!editing.value}>Save</button>
            </div>
          </form>
        </div>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this entry?"
          message={`${formatEntryTime(deleting.occurredAt, tz)} will be removed from ${tracker.title}.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => confirmDelete(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
