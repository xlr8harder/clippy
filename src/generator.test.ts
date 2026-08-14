import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import type { ClippyEvidence } from './context.ts'
import { assertGroundedSupport, CLIPPY_SYSTEM_PROMPT, generateClippyResponse } from './generator.ts'

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
    expect(CLIPPY_SYSTEM_PROMPT).toContain('exact excerpts')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('{"kind"')
    expect(CLIPPY_SYSTEM_PROMPT).not.toContain('describe what the person')
  })

  it('makes one isolated bounded model call and renders its validated draft', async () => {
    let captured: GenerateOptions | undefined
    const chunks = textChunks('{"kind":"workflow","support":["Bisect the duplicate-delivery bug across the queue workers."],"statement":"you are bisecting a duplicate-delivery bug across queue workers"}')
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
      'It looks like you are bisecting a duplicate-delivery bug across queue workers. Would you like help writing a letter?',
    )
    expect(captured).toMatchObject({
      provider: 'openrouter',
      model: 'deepseek/deepseek-v3.2',
      system: CLIPPY_SYSTEM_PROMPT,
      maxTokens: 1_024,
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
    const chunks = textChunks('{"kind":"workflow","support":["Bisect the duplicate-delivery bug across the queue workers."],"statement":"you are bisecting a duplicate-delivery bug across queue workers"}')
    const ctx = {
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
      '{"kind":"diagnosis","support":["Bisect the duplicate-delivery bug across the queue workers."],"statement":"you forgot to renew the queue lease"}',
      '{"kind":"workflow","support":["Bisect the duplicate-delivery bug across the queue workers."],"statement":"you are bisecting a duplicate-delivery bug across queue workers"}',
    ]
    const captured: GenerateOptions[] = []
    const ctx = {
      llm: {
        stream: (options: GenerateOptions) => {
          captured.push(options)
          return (async function* () { yield* textChunks(outputs[captured.length - 1]!) })()
        },
      },
    } as unknown as Context

    const text = await generateClippyResponse(ctx, fakeAgent(), new AbortController().signal, () => 0)

    expect(captured).toHaveLength(2)
    expect(JSON.stringify(captured[1]?.messages)).toContain('diagnosis is forbidden')
    expect(text).toBe(
      'It looks like you are bisecting a duplicate-delivery bug across queue workers. Would you like help writing a letter?',
    )
  })

  it('uses a generic workflow line when both model drafts are rejected', async () => {
    let calls = 0
    const ctx = {
      llm: {
        stream: () => {
          calls += 1
          return (async function* () { yield* textChunks('not JSON') })()
        },
      },
    } as unknown as Context

    const text = await generateClippyResponse(ctx, fakeAgent(), new AbortController().signal, () => 0)

    expect(calls).toBe(2)
    expect(text).toBe(
      'It looks like you are getting started on a new task. Would you like help writing a letter?',
    )
  })

  it('allows user evidence only for workflow fallback', () => {
    const evidence = {
      activityMinutes: 2,
      recentMessages: [
        { role: 'user', text: 'Find the race in the shared index.' },
        { role: 'assistant', text: '**The mutation source was not captured.**' },
      ],
      recentTools: [{
        name: 'run_tests',
        arguments: '--repeat 100',
        outcome: 'success',
        resultExcerpt: '99 passed; one assertion received four results instead of five',
      }],
      recentErrors: [],
      omittedEarlierContext: false,
    } satisfies ClippyEvidence

    expect(() => assertGroundedSupport({
      kind: 'observation',
      support: ['99 passed; one assertion received four results instead of five'],
    }, evidence)).not.toThrow()
    expect(() => assertGroundedSupport({
      kind: 'observation',
      support: ['The mutation source was not captured.'],
    }, evidence)).not.toThrow()
    expect(() => assertGroundedSupport({
      kind: 'diagnosis',
      support: ['Find the race in the shared index.'],
    }, evidence)).toThrow(/disallowed user source/)
    expect(() => assertGroundedSupport({
      kind: 'workflow',
      support: ['Find the race in the shared index.'],
    }, evidence)).not.toThrow()
  })
})
