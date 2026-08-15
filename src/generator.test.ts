import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ReasoningEffortId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  afterEach(() => vi.restoreAllMocks())

  it('prefers a blame-shaped explicit gap before causal diagnosis or neutral observation', () => {
    expect(CLIPPY_SYSTEM_PROMPT).toContain('0. apparent mistake (return kind observation)')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('you forgot to')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('must not claim why it happened')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('explicit intended result and visible gap')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('Tier 0 is rhetorical blame, not a causal diagnosis')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('Tier 0 is mandatory even when the mechanism is unknown')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('do not merely narrate the actual value with your')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('diagnosis')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('observation')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('workflow')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('directly established by the evidence')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('technical conclusion or consequential correction')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('conclusion, not the verification story')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('never say you corrected, you fixed, or you verified')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('such as your server, your test, or your build')
    expect(CLIPPY_SYSTEM_PROMPT).toContain('Never use your for a diagnosis or workflow')
    expect(CLIPPY_SYSTEM_PROMPT).not.toContain('say you found, you saw, or you measured')
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

  it('can use a dedicated configured model route without changing the agent route', async () => {
    let captured: GenerateOptions | undefined
    const ctx = {
      logger: fakeLogger(),
      llm: {
        stream: (options: GenerateOptions) => {
          captured = options
          return (async function* () {
            yield* textChunks('{"kind":"observation","statement":"you forgot to make the committed write reach every node"}')
          })()
        },
      },
    } as unknown as Context

    await generateClippyResponse(ctx, fakeAgent(), new AbortController().signal, () => 0, {
      provider: 'openrouter',
      model: '@preset/dsh-clippy-v4-flash-official',
      reasoningEffort: ReasoningEffortId('high'),
    })

    expect(captured).toMatchObject({
      provider: 'openrouter',
      model: '@preset/dsh-clippy-v4-flash-official',
      reasoningEffort: ReasoningEffortId('high'),
    })
  })

  it('retries a rejected draft once with diagnosis forbidden', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => new AbortController().signal)
    const outputs = [
      '{"kind":"guess","statement":"you forgot to renew the queue lease"}',
      '{"kind":"workflow","statement":"you are bisecting a duplicate-delivery bug across queue workers"}',
    ]
    const captured: GenerateOptions[] = []
    const warnings: string[] = []
    const ctx = {
      logger: fakeLogger(warnings),
      llm: {
        resolveModelInfo: async () => ({
          id: 'deepseek/deepseek-v4-pro-0813',
          name: 'DeepSeek V4 Pro',
          reasoning: {
            efforts: [
              { id: ReasoningEffortId('low'), name: 'Low' },
              { id: ReasoningEffortId('high'), name: 'High' },
            ],
          },
        }),
        stream: (options: GenerateOptions) => {
          captured.push(options)
          return (async function* () { yield* textChunks(outputs[captured.length - 1]!) })()
        },
      },
    } as unknown as Context

    const text = await generateClippyResponse(
      ctx,
      fakeAgent(ReasoningEffortId('high')),
      new AbortController().signal,
      () => 0,
    )

    expect(captured).toHaveLength(2)
    expect(timeout.mock.calls).toEqual([[90_000], [90_000]])
    expect(captured[0]?.signal).not.toBe(captured[1]?.signal)
    expect(captured.map(request => request.maxTokens)).toEqual([2_048, 2_048])
    expect(captured.map(request => request.reasoningEffort)).toEqual([
      ReasoningEffortId('high'),
      ReasoningEffortId('low'),
    ])
    expect(JSON.stringify(captured[1]?.messages)).toContain('diagnosis is forbidden')
    expect(warnings).toEqual(['[dsh-clippy] primary generation failed: schema'])
    expect(text).toBe(
      'It looks like you are bisecting a duplicate-delivery bug across queue workers. Would you like help writing a letter?',
    )
  })

  it('preserves the original reasoning effort when the model does not advertise low', async () => {
    const captured: GenerateOptions[] = []
    const outputs = [
      'not JSON',
      '{"kind":"workflow","statement":"you are bisecting a duplicate-delivery bug across queue workers"}',
    ]
    const ctx = {
      logger: fakeLogger(),
      llm: {
        resolveModelInfo: async () => ({
          id: 'custom-reasoner',
          name: 'Custom reasoner',
          reasoning: {
            efforts: [{ id: ReasoningEffortId('high'), name: 'High' }],
          },
        }),
        stream: (options: GenerateOptions) => {
          captured.push(options)
          return (async function* () { yield* textChunks(outputs[captured.length - 1]!) })()
        },
      },
    } as unknown as Context

    await generateClippyResponse(
      ctx,
      fakeAgent(ReasoningEffortId('high')),
      new AbortController().signal,
      () => 0,
    )

    expect(captured.map(request => request.reasoningEffort)).toEqual([
      ReasoningEffortId('high'),
      ReasoningEffortId('high'),
    ])
  })

  it('hard-bounds stalled provider reads for both generation attempts', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const warnings: string[] = []
    let calls = 0
    const ctx = {
      logger: fakeLogger(warnings),
      llm: {
        stream: () => {
          calls += 1
          return {
            [Symbol.asyncIterator]: () => ({
              next: () => new Promise<IteratorResult<StreamChunk>>(() => {}),
            }),
          }
        },
      },
    } as unknown as Context
    const first = new AbortController()
    const second = new AbortController()
    timeout
      .mockImplementationOnce(() => first.signal)
      .mockImplementationOnce(() => second.signal)

    const pending = generateClippyResponse(ctx, fakeAgent(), new AbortController().signal, () => 0)
    await vi.waitFor(() => expect(calls).toBe(1))
    first.abort(new DOMException('timed out', 'TimeoutError'))
    await vi.waitFor(() => expect(calls).toBe(2))
    second.abort(new DOMException('timed out', 'TimeoutError'))

    await expect(pending).resolves.toBe(
      'It looks like you are getting started on a new task. Would you like help writing a letter?',
    )
    expect(timeout.mock.calls).toEqual([[90_000], [90_000]])
    expect(warnings).toEqual([
      '[dsh-clippy] primary generation failed: timeout',
      '[dsh-clippy] retry generation failed: timeout',
    ])
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
