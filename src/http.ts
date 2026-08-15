/** Quiet same-origin HTTP trigger used by the visible browser timer. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { generateClippyResponse, type ClippyModelRouteOverride } from './generator.ts'

export const CLIPPY_GENERATE_PATH = '/api/clippy/generate'
const MAX_BODY_BYTES = 4_096

class HttpFailure extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.destroyed || res.writableEnded) return
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  })
  res.end(data)
}

function assertSameOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin
  if (origin === undefined) return
  let authority: string
  try {
    authority = new URL(origin).host
  } catch {
    throw new HttpFailure(403, 'invalid request origin')
  }
  if (req.headers.host === undefined || authority !== req.headers.host) {
    throw new HttpFailure(403, 'cross-origin Clippy generation is not allowed')
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const type = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (type !== 'application/json') throw new HttpFailure(415, 'content-type must be application/json')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new HttpFailure(413, 'request body is too large')
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error: unknown) {
    throw new HttpFailure(400, `invalid JSON: ${error instanceof Error ? error.message : 'parse failed'}`)
  }
}

function sessionIdFrom(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpFailure(400, 'request body must be an object')
  }
  const keys = Object.keys(body).sort()
  if (keys.length !== 1 || keys[0] !== 'sessionId') {
    throw new HttpFailure(400, 'request body must contain exactly sessionId')
  }
  const value = (body as { sessionId?: unknown }).sessionId
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new HttpFailure(400, 'sessionId must be a non-empty string of at most 256 characters')
  }
  return value
}

export function makeClippyGenerateHandler(ctx: Context, routeOverride: ClippyModelRouteOverride = {}) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (req.method !== 'POST') throw new HttpFailure(405, 'method must be POST')
      assertSameOrigin(req)
      const sessionId = sessionIdFrom(await readJson(req))
      const agent = ctx.agents.get(SessionId(sessionId))
      if (agent === undefined) throw new HttpFailure(404, 'session has no live agent')

      const controller = new AbortController()
      const abortRequest = (): void => controller.abort(new Error('Clippy request disconnected'))
      req.once('aborted', abortRequest)
      try {
        const text = await generateClippyResponse(ctx, agent, controller.signal, Math.random, routeOverride)
        writeJson(res, 200, { text })
      } finally {
        req.off('aborted', abortRequest)
      }
    } catch (error: unknown) {
      if (error instanceof HttpFailure) {
        writeJson(res, error.status, { error: error.message })
        return
      }
      ctx.logger.warn('clippy generation failed')
      writeJson(res, 500, { error: 'Clippy generation failed' })
    }
  }
}
