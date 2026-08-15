import { describe, expect, it } from 'vitest'
import Clippy from 'clippyjs/agents/clippy'
import {
  chooseIdleAmbient,
  chooseIdleFlourish,
  IDLE_AMBIENT_ANIMATIONS,
  IDLE_AMBIENT_MAX_MS,
  IDLE_AMBIENT_MIN_MS,
  IDLE_FLOURISH_ANIMATIONS,
  IDLE_FLOURISH_MAX_MS,
  IDLE_FLOURISH_MIN_MS,
  IDLE_SETTLE_ANIMATION,
  idleAmbientDelay,
  idleFlourishDelay,
} from './idle.ts'

describe('idle flourishes', () => {
  it('uses a short bounded delay between quiet ambient motions', () => {
    expect(idleAmbientDelay(0)).toBe(IDLE_AMBIENT_MIN_MS)
    expect(idleAmbientDelay(1)).toBe(IDLE_AMBIENT_MAX_MS)
  })

  it('selects a valid quiet ambient motion even when the base set has one member', () => {
    expect(chooseIdleAmbient('IdleEyeBrowRaise', 0)).toBe('IdleEyeBrowRaise')
    expect(chooseIdleAmbient('IdleEyeBrowRaise', 0.999)).toBe('IdleEyeBrowRaise')
  })

  it('settles with one subdued motion rather than a conspicuous burst', () => {
    expect(IDLE_SETTLE_ANIMATION).toBe('IdleEyeBrowRaise')
  })

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
    expect(Object.keys(data.animations)).toEqual(expect.arrayContaining([...IDLE_AMBIENT_ANIMATIONS]))
    expect(Object.keys(data.animations)).toEqual(expect.arrayContaining([...IDLE_FLOURISH_ANIMATIONS]))
  })
})
