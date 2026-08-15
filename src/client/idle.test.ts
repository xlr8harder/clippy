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
  IDLE_SETTLE_SEQUENCE,
  idleAmbientDelay,
  idleFlourishDelay,
} from './idle.ts'

describe('idle flourishes', () => {
  it('uses a short bounded delay between quiet ambient motions', () => {
    expect(idleAmbientDelay(0)).toBe(IDLE_AMBIENT_MIN_MS)
    expect(idleAmbientDelay(1)).toBe(IDLE_AMBIENT_MAX_MS)
  })

  it('does not immediately repeat a quiet ambient motion', () => {
    for (const previous of IDLE_AMBIENT_ANIMATIONS) {
      expect(chooseIdleAmbient(previous, 0)).not.toBe(previous)
      expect(chooseIdleAmbient(previous, 0.999)).not.toBe(previous)
    }
  })

  it('settles visibly with an immediate motion followed by the longer idle', () => {
    expect(IDLE_SETTLE_SEQUENCE).toEqual(['IdleEyeBrowRaise', 'IdleSideToSide'])
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
