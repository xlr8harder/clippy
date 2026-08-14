import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ReasoningEffortId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { CLIPPY_SYSTEM_PROMPT, generateClippyResponse } from './generator.ts'

function fakeLogger(warnings: string[] = []) {
  return {
    warn: (format: string, ...values: unknown[]) => {
      warnings.push(values.reduce((text, value) => text.replace('%s', String(value)), format))
    },
  }
}

function fakeAgent(reasoningEffort?: ReturnType<typeof ReasoningEffortId>): Agent {
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
      requestHeader: () => ({
        config: {
          provider: 'openrouter',
          model: 'deepseek/deepseek-v4-pro-0813',
          ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
        },
      }),
    },
  } as unknown as Agent
}

function textChunks(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

describe('generateClippyResponse', () => {
  it('asks for the strongest grounded statement on an explicit confidence ladder', () => {
    expect(CLIPPY_SYSTEM_PROMPT).toContain('diagnosis')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('observation')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('workflow')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('directly established by the evidence')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('technical conclusion or consequential correction')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('conclusion, not the verification story')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('never say you corrected, you fixed, or you verified')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('{"kind"')
    expect(CLIPPY_SYSTEM_PROMPT).not.toContain('"support"')
    expect(CLIPPY_SYSTEM_PROMPT).not.toContain('describe what the person')
  })

  it('makes one isolated bounded model call and renders its validated draft', async () => {
    let captured: GenerateOptions | undefined
    const chunks = textChunks('{"kind":"workflow","statement":"you are bisecting a duplicate-delivery bug across queue workers"}')
    const ctx = {
      logger: fakeLogger(),
      llm: {
        stream: (options: GenerateOptions) => {
          captured = options
          return (async function* () { yield* chunks })()
        },
      },
    } as unknown as Context

    const text = await generateClippyResponse(
      ctx,
      fakeAgent(ReasoningEffortId('high')),
      new AbortController().signal,
      () => 0,
    )

    expect(text).toBe(
      'It looks like you are bisecting a duplicate-delivery bug across queue workers. Would you like help writing a letter?',
    )
    expect(captured).toMatchObject({
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-pro-0813',
      reasoningEffort: ReasoningEffortId('high'),
      system: CLIPPY_SYSTEM_PROMPT,
      maxTokens: 2_048,
      temperature: 0.2,
      sessionId: SessionId('session-clippy-test'),
    })
    expect(captured).not.toHaveProperty('tools')
    expect(captured).not.toHaveProperty('purpose')
    expect(captured?.messages).toHaveLength(1)
    const serialized = JSON.stringify(captured?.messages)
    expect(serialized).toContain('Bisect the duplicate-delivery bug')
    expect(serialized).not.toContain('recentClippyOffers')
    expect(serialized).not.toContain('private analysis')
  })

  it('does not repeat a random Office offer', async () => {
    const chunks = textChunks('{"kind":"workflow","statement":"you are bisecting a duplicate-delivery bug across queue workers"}')
    const ctx = {
      logger: fakeLogger(),
      llm: { stream: () => (async function* () { yield* chunks })() },
    } as unknown as Context
    const agent = fakeAgent()

    const first = await generateClippyResponse(ctx, agent, new AbortController().signal, () => 0)
    const second = await generateClippyResponse(ctx, agent, new AbortController().signal, () => 0)

    expect(first).toMatch(/writing a letter/)
    expect(second).toMatch(/drafting a résumé/)
  })

  it('retries a rejected draft once with diagnosis forbidden', async () => {
    const outputs = [
      '{"kind":"guess","statement":"you forgot to renew the queue lease"}',
      '{"kind":"workflow","statement":"you are bisecting a duplicate-delivery bug across queue workers"}',
    ]
    const captured: GenerateOptions[] = []
    const warnings: string[] = []
    const ctx = {
      logger: fakeLogger(warnings),
      llm: {
        stream: (options: GenerateOptions) => {
          captured.push(options)
          return (async function* () { yield* textChunks(outputs[captured.length - 1]!) })()
        },
      },
    } as unknown as Context

    const text = await generateClippyResponse(ctx, fakeAgent(), new AbortController().signal, () => 0)

    expect(captured).toHaveLength(2)
    expect(captured[0]?.signal).not.toBe(captured[1]?.signal)
    expect(captured.map(request => request.maxTokens)).toEqual([2_048, 2_048])
    expect(JSON.stringify(captured[1]?.messages)).toContain('diagnosis is forbidden')
    expect(warnings).toEqual(['[dsh-clippy] primary generation failed: schema'])
    expect(text).toBe(
      'It looks like you are bisecting a duplicate-delivery bug across queue workers. Would you like help writing a letter?',
    )
  })

  it('uses a generic workflow line when both model drafts are rejected', async () => {
    let calls = 0
    const warnings: string[] = []
    const ctx = {
      logger: fakeLogger(warnings),
      llm: {
        stream: () => {
          calls += 1
          return (async function* () { yield* textChunks('not JSON') })()
        },
      },
    } as unknown as Context

    const text = await generateClippyResponse(ctx, fakeAgent(), new AbortController().signal, () => 0)

    expect(calls).toBe(2)
    expect(warnings).toEqual([
      '[dsh-clippy] primary generation failed: non-json',
      '[dsh-clippy] retry generation failed: non-json',
    ])
    expect(text).toBe(
      'It looks like you are getting started on a new task. Would you like help writing a letter?',
    )
  })

  it('accepts a usable first draft even when a legacy support field is inexact', async () => {
    let calls = 0
    const ctx = {
      logger: fakeLogger(),
      llm: {
        stream: () => {
          calls += 1
          return (async function* () {
            yield* textChunks('{"kind":"observation","support":["not an exact excerpt"],"statement":"you found one queue worker delivering the same job twice"}')
          })()
        },
      },
    } as unknown as Context

    const text = await generateClippyResponse(ctx, fakeAgent(), new AbortController().signal, () => 0)

    expect(calls).toBe(1)
    expect(text).toContain('you found one queue worker delivering the same job twice')
  })
})
