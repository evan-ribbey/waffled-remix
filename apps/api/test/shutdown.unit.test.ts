import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { installShutdown } from '../src/platform/shutdown'

function fakes() {
  const proc = Object.assign(new EventEmitter(), { exit: vi.fn() })
  let onClosed: (() => void) | undefined
  const server = {
    close: vi.fn((cb: () => void) => { onClosed = cb }),
    closeIdleConnections: vi.fn(),
    closeAllConnections: vi.fn(),
  }
  const closePool = vi.fn(async () => undefined)
  return { proc, server, closePool, finishClose: () => onClosed?.() }
}

describe('installShutdown', () => {
  it('stops accepting, drains, closes the pool and exits 0 on SIGTERM', async () => {
    const f = fakes()
    installShutdown(f.server as never, f.closePool, { proc: f.proc as never, graceMs: 1000 })
    f.proc.emit('SIGTERM')
    expect(f.server.close).toHaveBeenCalled()
    expect(f.server.closeIdleConnections).toHaveBeenCalled()
    f.finishClose()
    await vi.waitFor(() => expect(f.proc.exit).toHaveBeenCalledWith(0))
    expect(f.closePool).toHaveBeenCalled()
  })

  it('forces connections closed and exits when draining takes too long', async () => {
    vi.useFakeTimers()
    try {
      const f = fakes()
      installShutdown(f.server as never, f.closePool, { proc: f.proc as never, graceMs: 1000 })
      f.proc.emit('SIGINT')
      await vi.advanceTimersByTimeAsync(1001)
      expect(f.server.closeAllConnections).toHaveBeenCalled()
      expect(f.proc.exit).toHaveBeenCalledWith(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('handles a second signal without starting a second shutdown', () => {
    const f = fakes()
    installShutdown(f.server as never, f.closePool, { proc: f.proc as never, graceMs: 1000 })
    f.proc.emit('SIGTERM')
    f.proc.emit('SIGTERM')
    expect(f.server.close).toHaveBeenCalledTimes(1)
  })
})
