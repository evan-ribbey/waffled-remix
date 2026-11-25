import type http from 'node:http'
import { log } from './logger'

type ShutdownServer = Pick<http.Server, 'close' | 'closeIdleConnections' | 'closeAllConnections'>

// Node is PID 1 in the container, where an unhandled SIGTERM is ignored; without this,
// every `docker compose` stop or upgrade waits out the timeout and is SIGKILLed.
export function installShutdown(
  server: ShutdownServer,
  closePool: () => Promise<void>,
  opts: { proc?: NodeJS.Process; graceMs?: number } = {},
): void {
  const proc = opts.proc ?? process
  const graceMs = opts.graceMs ?? 8000
  let stopping = false
  const finish = async () => {
    await closePool().catch(() => undefined)
    proc.exit(0)
  }
  const stop = (signal: string) => {
    if (stopping) return
    stopping = true
    log.info('shutting down', { signal })
    const force = setTimeout(() => {
      server.closeAllConnections()
      void finish()
    }, graceMs)
    force.unref?.()
    server.close(() => {
      clearTimeout(force)
      void finish()
    })
    server.closeIdleConnections()
  }
  proc.on('SIGTERM', () => stop('SIGTERM'))
  proc.on('SIGINT', () => stop('SIGINT'))
}
