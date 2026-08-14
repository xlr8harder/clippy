/** Full Clippit idle actions are much larger than a sprite blink, so keep them sparse. */
export const IDLE_FLOURISH_MIN_MS = 90_000
export const IDLE_FLOURISH_MAX_MS = 240_000

/** Authentic, comparatively quiet Clippit idle animations. */
export const IDLE_FLOURISH_ANIMATIONS = Object.freeze([
  'Idle1_1',
  'IdleSideToSide',
  'IdleHeadScratch',
  'IdleFingerTap',
  'IdleEyeBrowRaise',
] as const)

export type IdleFlourish = (typeof IDLE_FLOURISH_ANIMATIONS)[number]

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
