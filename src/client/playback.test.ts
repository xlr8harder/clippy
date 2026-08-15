import { describe, expect, it } from 'vitest'
import {
  animationStateAction,
  clearPendingActivity,
  completeActivityPlayback,
  EMPTY_ACTIVITY_PLAYBACK,
  pageIsActive,
  pendingSpeechToReplay,
  requestActivityPlayback,
} from './playback.ts'

describe('activity playback', () => {
  it('does not reset an active animation and retains only the newest state', () => {
    const thinking = requestActivityPlayback(EMPTY_ACTIVITY_PLAYBACK, 'thinking')
    expect(thinking).toEqual({ state: { active: 'thinking' }, start: 'thinking' })

    const writing = requestActivityPlayback(thinking.state, 'writing')
    expect(writing).toEqual({ state: { active: 'thinking', pending: 'writing' } })

    const tool = requestActivityPlayback(writing.state, 'tool')
    expect(tool).toEqual({ state: { active: 'thinking', pending: 'tool' } })

    expect(completeActivityPlayback(tool.state, 'thinking')).toEqual({
      state: { active: 'tool' },
      start: 'tool',
    })
  })

  it('ignores repeated requests and stale completion callbacks', () => {
    const active = { active: 'writing' as const }
    expect(requestActivityPlayback(active, 'writing')).toEqual({ state: active })
    expect(completeActivityPlayback(active, 'thinking')).toEqual({ state: active })
    expect(completeActivityPlayback(active, 'writing')).toEqual({ state: EMPTY_ACTIVITY_PLAYBACK })
  })

  it('drops pending work on idle without interrupting the active animation', () => {
    expect(clearPendingActivity({ active: 'thinking', pending: 'done' })).toEqual({ active: 'thinking' })
  })

  it('requires both page visibility and window focus', () => {
    expect(pageIsActive('visible', true)).toBe(true)
    expect(pageIsActive('visible', false)).toBe(false)
    expect(pageIsActive('hidden', true)).toBe(false)
  })

  it('exits a waiting animation through its authored exit branch', () => {
    expect(animationStateAction(1)).toBe('request-exit')
    expect(animationStateAction(0)).toBe('complete')
    expect(animationStateAction(2)).toBe('continue')
  })

  it('does not replay an already visible balloon after focus returns', () => {
    expect(pendingSpeechToReplay('active balloon', 'active balloon')).toBeUndefined()
    expect(pendingSpeechToReplay(undefined, 'arrived while hidden')).toBe('arrived while hidden')
  })
})
