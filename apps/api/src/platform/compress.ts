import type http from 'node:http'
import { gzipSync } from 'node:zlib'

const MIN_BYTES = 1024
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|manifest\+json|xml)|image\/svg\+xml)/i

export function acceptsGzip(req: http.IncomingMessage): boolean {
  const ae = req.headers['accept-encoding']
  return typeof ae === 'string' && /\bgzip\b/i.test(ae)
}

export function isCompressible(contentType: string | undefined, bytes: number): boolean {
  return bytes >= MIN_BYTES && !!contentType && COMPRESSIBLE.test(contentType)
}

export function gzip(body: Buffer): Buffer {
  return gzipSync(body, { level: 6 })
}

/** Adds Accept-Encoding to an existing Vary header without duplicating it. */
export function varyOnEncoding(current: string | number | string[] | undefined): string {
  const v = Array.isArray(current) ? current.join(', ') : current ? String(current) : ''
  if (/accept-encoding/i.test(v)) return v
  return v ? `${v}, Accept-Encoding` : 'Accept-Encoding'
}
