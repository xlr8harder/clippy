import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { CLIPPY_SYSTEM_PROMPT, generateClippyResponse } from './generator.ts'

function fakeAgent(): Agent {
  const message = createUserMessage({
    content: [
      { type: 'text', text: 'Bisect the duplicate-delivery bug across the queue workers.' },
      { type: 'reasoning', text: 'private analysis must never be projected' },
    ],
    source: { kind: 'user' },
  })
  return {
    id: SessionId('session-clippy-test'),
    options: { provider: 'fallback-provider', model: 'fallback-model' },
    session: {
      deriveMessages: () => [message],
      events: [],
      header: { cwd: '/work/queue' },
      requestHeader: () => ({ config: { provider: 'openrouter', model: 'deepseek/deepseek-v3.2' } }),
    },
  } as unknown as Agent
}

describe('generateClippyResponse', () => {
  it('makes one isolated bounded model call and renders its validated draft', async () => {
    let captured: GenerateOptions | undefined
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      {
        type: 'text-delta',
        index: 0,
        text: '{"observation":"you are bisecting a duplicate-delivery bug across queue workers","officeTasks":["resume","spreadsheet","fax"]}',
      },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const ctx = {
      llm: {
        stream: (options: GenerateOptions) => {
          captured = options
          return (async function* () { yield* chunks })()
        },
      },
    } as unknown as Context

    const text = await generateClippyResponse(ctx, fakeAgent(), new AbortController().signal, () => 0)

    expect(text).toBe(
      'It looks like you are bisecting a duplicate-delivery bug across queue workers. Would you like help drafting a résumé?',
    )
    expect(captured).toMatchObject({
      provider: 'openrouter',
      model: 'deepseek/deepseek-v3.2',
      system: CLIPPY_SYSTEM_PROMPT,
      maxTokens: 220,
      temperature: 0.4,
      sessionId: SessionId('session-clippy-test'),
    })
    expect(captured).not.toHaveProperty('tools')
    expect(captured).not.toHaveProperty('purpose')
    expect(captured?.messages).toHaveLength(1)
    const serialized = JSON.stringify(captured?.messages)
    expect(serialized).toContain('Bisect the duplicate-delivery bug')
    expect(serialized).toContain('recentClippyOffers')
    expect(serialized).not.toContain('private analysis')
  })

  it('does not repeat an Office offer when the model keeps proposing the same one', async () => {
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      {
        type: 'text-delta',
        index: 0,
        text: '{"observation":"you are diagnosing a queue race","officeTasks":["memo","letter","fax"]}',
      },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const ctx = {
      llm: { stream: () => (async function* () { yield* chunks })() },
    } as unknown as Context
    const agent = fakeAgent()

    const first = await generateClippyResponse(ctx, agent, new AbortController().signal, () => 0)
    const second = await generateClippyResponse(ctx, agent, new AbortController().signal, () => 0)

    expect(first).toMatch(/preparing a memo/)
    expect(second).toMatch(/writing a letter/)
  })
})
