import { createServer, type AddressInfo } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'

const generateClippyResponse = vi.hoisted(() => vi.fn())

vi.mock('./generator.ts', () => ({ generateClippyResponse }))

import { CLIPPY_GENERATE_PATH, makeClippyGenerateHandler } from './http.ts'

const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  generateClippyResponse.mockReset()
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => { if (error === undefined) resolve(); else reject(error) })
  })))
})

describe('Clippy automatic generation endpoint', () => {
  it('accepts a live session while its agent is running', async () => {
    const agent = { status: 'running' }
    const ctx = {
      agents: { get: vi.fn(() => agent) },
      logger: { warn: vi.fn() },
    } as unknown as Context
    generateClippyResponse.mockResolvedValue('It looks like your tests found a loose end.')
    const handler = makeClippyGenerateHandler(ctx)
    const server = createServer((req, res) => { void handler(req, res) })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', resolve)
      server.once('error', reject)
    })
    const address = server.address() as AddressInfo

    const response = await fetch(`http://127.0.0.1:${address.port}${CLIPPY_GENERATE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ text: 'It looks like your tests found a loose end.' })
    expect(ctx.agents.get).toHaveBeenCalledWith('session-1')
    expect(generateClippyResponse).toHaveBeenCalledOnce()
    expect(generateClippyResponse.mock.calls[0]?.[1]).toBe(agent)
    expect(generateClippyResponse.mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal)
  })
})
