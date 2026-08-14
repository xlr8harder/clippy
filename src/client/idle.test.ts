import { describe, expect, it } from 'vitest'
import Clippy from 'clippyjs/agents/clippy'
import {
  chooseIdleFlourish,
  IDLE_FLOURISH_ANIMATIONS,
  IDLE_FLOURISH_MAX_MS,
  IDLE_FLOURISH_MIN_MS,
  idleFlourishDelay,
} from './idle.ts'

describe('idle flourishes', () => {
  it('uses a bounded randomized interval', () => {
    expect(idleFlourishDelay(0)).toBe(IDLE_FLOURISH_MIN_MS)
    expect(idleFlourishDelay(1)).toBe(IDLE_FLOURISH_MAX_MS)
  })

  it('does not immediately repeat an animation', () => {
    for (const previous of IDLE_FLOURISH_ANIMATIONS) {
      expect(chooseIdleFlourish(previous, 0)).not.toBe(previous)
      expect(chooseIdleFlourish(previous, 0.999)).not.toBe(previous)
    }
  })

  it('only names authentic Clippit idle animations', async () => {
    const { default: data } = await Clippy.agent()
    expect(Object.keys(data.animations)).toEqual(expect.arrayContaining([...IDLE_FLOURISH_ANIMATIONS]))
  })
})
