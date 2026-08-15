/** Full Clippit idle actions are much larger than a sprite blink, so keep them sparse. */
export const IDLE_FLOURISH_MIN_MS = 90_000
export const IDLE_FLOURISH_MAX_MS = 240_000

/** A small motion between state changes so the resting sprite never feels dead. */
export const IDLE_AMBIENT_MIN_MS = 12_000
export const IDLE_AMBIENT_MAX_MS = 30_000

export const IDLE_AMBIENT_ANIMATIONS = Object.freeze([
  'IdleEyeBrowRaise',
] as const)

export type IdleAmbient = (typeof IDLE_AMBIENT_ANIMATIONS)[number]

/** One subdued handoff used after startup, activity, and speech. */
export const IDLE_SETTLE_ANIMATION: IdleAmbient = 'IdleEyeBrowRaise'

/** Authentic, comparatively quiet Clippit idle animations. */
export const IDLE_FLOURISH_ANIMATIONS = Object.freeze([
  'Idle1_1',
  'IdleSideToSide',
  'IdleHeadScratch',
  'IdleFingerTap',
] as const)

export type IdleFlourish = (typeof IDLE_FLOURISH_ANIMATIONS)[number]

export function idleAmbientDelay(random: number): number {
  const roll = Math.min(Math.max(random, 0), 1 - Number.EPSILON)
  return IDLE_AMBIENT_MIN_MS
    + Math.floor(roll * (IDLE_AMBIENT_MAX_MS - IDLE_AMBIENT_MIN_MS + 1))
}

/** Select a quiet base motion; the list deliberately supports future additions. */
export function chooseIdleAmbient(previous: IdleAmbient | undefined, random: number): IdleAmbient {
  const alternatives = previous === undefined
    ? IDLE_AMBIENT_ANIMATIONS
    : IDLE_AMBIENT_ANIMATIONS.filter(animation => animation !== previous)
  const choices = alternatives.length === 0 ? IDLE_AMBIENT_ANIMATIONS : alternatives
  const roll = Math.min(Math.max(random, 0), 1 - Number.EPSILON)
  return choices[Math.floor(roll * choices.length)]!
}

export function idleFlourishDelay(random: number): number {
  const roll = Math.min(Math.max(random, 0), 1 - Number.EPSILON)
  return IDLE_FLOURISH_MIN_MS
    + Math.floor(roll * (IDLE_FLOURISH_MAX_MS - IDLE_FLOURISH_MIN_MS + 1))
}

/** Pick a real idle action without immediately repeating the previous flourish. */
export function chooseIdleFlourish(previous: IdleFlourish | undefined, random: number): IdleFlourish {
  const choices = previous === undefined
    ? IDLE_FLOURISH_ANIMATIONS
    : IDLE_FLOURISH_ANIMATIONS.filter(animation => animation !== previous)
  const roll = Math.min(Math.max(random, 0), 1 - Number.EPSILON)
  return choices[Math.floor(roll * choices.length)]!
}
