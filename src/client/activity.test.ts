import { describe, expect, it } from 'vitest'
import Clippy from 'clippyjs/agents/clippy'
import { ACTIVITY_ANIMATION, deriveActivity, type ActivityInput } from './activity.ts'

const idle: ActivityInput = {
  running: false,
  hasPartial: false,
  runningCallCount: 0,
  pendingCount: 0,
  lastAgentError: null,
}

describe('deriveActivity', () => {
  it('distinguishes thinking, writing, and tool activity', () => {
    expect(deriveActivity({ ...idle, running: true }, false)).toBe('thinking')
    expect(deriveActivity({ ...idle, running: true, hasPartial: true }, true)).toBe('writing')
    expect(deriveActivity({ ...idle, running: true, runningCallCount: 1 }, true)).toBe('tool')
  })

  it('reports pending interaction while the agent is not running', () => {
    expect(deriveActivity({ ...idle, pendingCount: 1 }, false)).toBe('waiting')
  })

  it('emits completion and failure only across a running-to-stopped transition', () => {
    expect(deriveActivity(idle, true)).toBe('done')
    expect(deriveActivity({ ...idle, lastAgentError: 'provider failed' }, true)).toBe('error')
    expect(deriveActivity({ ...idle, lastAgentError: 'old failure' }, false)).toBe('idle')
  })

  it('maps every active state to a real Clippit animation name', async () => {
    expect(ACTIVITY_ANIMATION).toEqual({
      thinking: 'Thinking',
      writing: 'Writing',
      tool: 'Searching',
      waiting: 'GetAttention',
      done: 'Congratulate',
      error: 'Alert',
    })
    const { default: data } = await Clippy.agent()
    expect(Object.keys(data.animations)).toEqual(expect.arrayContaining(Object.values(ACTIVITY_ANIMATION)))
  })
})
