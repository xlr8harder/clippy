import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it } from 'vitest'
import { automaticActivityStamp } from './auto.ts'

function snapshot(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    nodes: [],
    partial: null,
    runningCalls: [],
    pending: [],
    queue: [],
    running: false,
    lastAgentError: null,
    ...overrides,
  } as unknown as ConversationSnapshot
}

describe('automaticActivityStamp', () => {
  it('is stable while an idle trace has not changed', () => {
    const idle = snapshot({
      nodes: [{ kind: 'turn-max-tokens', seq: 4, time: 10, turn: 1, step: 2 }],
    })
    expect(automaticActivityStamp(idle)).toBe(automaticActivityStamp({ ...idle }))
  })

  it('does not treat Clippy command churn as new evidence', () => {
    const before = snapshot()
    const whileRunning = snapshot({
      nodes: [{
        kind: 'command', seq: 1, time: 10, commandId: 'one' as never,
        name: 'clippy', args: '', outcome: null,
      }],
    })
    const completed = snapshot({
      nodes: [{
        kind: 'command', seq: 1, time: 10, commandId: 'one' as never,
        name: 'clippy', args: '', outcome: { kind: 'success', text: 'a comment' },
      }],
    })
    expect(automaticActivityStamp(whileRunning)).toBe(automaticActivityStamp(before))
    expect(automaticActivityStamp(completed)).toBe(automaticActivityStamp(before))
  })

  it('re-arms for real commands, user-visible progress, and run-state changes', () => {
    const idle = snapshot()
    const command = snapshot({
      nodes: [{
        kind: 'command', seq: 1, time: 10, commandId: 'one' as never,
        name: 'snapshot', args: ' now', outcome: null,
      }],
    })
    const partial = snapshot({
      partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: 'working' }] },
    })
    expect(automaticActivityStamp(command)).not.toBe(automaticActivityStamp(idle))
    expect(automaticActivityStamp(partial)).not.toBe(automaticActivityStamp(idle))
    expect(automaticActivityStamp(snapshot({ running: true }))).not.toBe(automaticActivityStamp(idle))
  })

  it('does not re-arm for private reasoning alone', () => {
    const first = snapshot({
      partial: { turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'private one' }] },
    })
    const second = snapshot({
      partial: { turn: 1, step: 1, blocks: [{ kind: 'reasoning', text: 'private one and two' }] },
    })
    expect(automaticActivityStamp(first)).toBe(automaticActivityStamp(second))
  })

  it('detects visible partial changes even when their lengths match', () => {
    const first = snapshot({
      partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: 'passed' }] },
    })
    const second = snapshot({
      partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: 'failed' }] },
    })
    expect(automaticActivityStamp(first)).not.toBe(automaticActivityStamp(second))
  })
})
