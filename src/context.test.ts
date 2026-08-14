import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { buildClippyEvidence, continuousActivityMinutes, messageEvidence } from './context.ts'

function event<T extends SessionEvent['type']>(
  seq: number,
  time: number,
  type: T,
  data: Extract<SessionEvent, { type: T }>['data'],
): Extract<SessionEvent, { type: T }> {
  return { seq, time, type, data } as Extract<SessionEvent, { type: T }>
}

describe('Clippy evidence projection', () => {
  it('omits private reasoning while retaining visible text', () => {
    const message = createUserMessage({
      source: { kind: 'plugin', plugin: 'test' },
      content: [
        { type: 'reasoning', text: 'secret chain' },
        { type: 'text', text: 'visible conclusion' },
      ],
    })
    expect(messageEvidence(message)).toEqual({ role: 'user', text: 'visible conclusion' })
  })

  it('derives continuous activity from the last gap-bounded event run', () => {
    const events = [
      event(0, 0, 'turn/start', { turn: 1 }),
      event(1, 10 * 60_000, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      event(2, 60 * 60_000, 'turn/start', { turn: 2 }),
      event(3, 80 * 60_000, 'turn/end', { turn: 2, reason: { kind: 'completed' } }),
    ]
    expect(continuousActivityMinutes(events, 90 * 60_000)).toBe(30)
  })

  it('combines canonical messages with bounded tool and error evidence', () => {
    const callId = CallId('call-1')
    const messages: Message[] = [createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'Find the duplicate delivery bug' }],
    })]
    const events: SessionEvent[] = [
      event(0, 1_000, 'tool/call', {
        turn: 1, step: 1, callId, name: 'bash', arguments: '{"cmd":"git bisect run ./repro"}',
      }),
      event(1, 2_000, 'tool/result', {
        turn: 1,
        step: 1,
        message: createToolResultMessage({
          callId,
          content: [{ type: 'text', text: 'reproduction failed' }],
          isError: true,
        }),
        error: { name: 'CommandError', code: 'EXIT_1' },
      }),
    ]
    const agent = {
      session: {
        deriveMessages: () => messages,
        events,
        header: { cwd: '/work/project' },
      },
    } as unknown as Agent
    expect(buildClippyEvidence(agent, 3_000)).toMatchObject({
      cwd: '/work/project',
      recentMessages: [{ role: 'user', text: 'Find the duplicate delivery bug' }],
      recentTools: [{
        name: 'bash',
        arguments: '{"cmd":"git bisect run ./repro"}',
        outcome: 'error',
        resultExcerpt: '[tool result: error] reproduction failed',
      }],
      recentErrors: ['CommandError (EXIT_1): [tool result: error] reproduction failed'],
    })
  })
})
