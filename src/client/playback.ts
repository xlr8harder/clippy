import type { ClippyActivity } from './activity.ts'

export type PlayableActivity = Exclude<ClippyActivity, 'idle'>

export interface ActivityPlaybackState {
  readonly active?: PlayableActivity
  readonly pending?: PlayableActivity
}

export interface ActivityPlaybackTransition {
  readonly state: ActivityPlaybackState
  readonly start?: PlayableActivity
  /** The current animation should take its authored exit branch now. */
  readonly exitActive?: boolean
}

export const EMPTY_ACTIVITY_PLAYBACK: ActivityPlaybackState = Object.freeze({})

export type AnimationStateAction = 'request-exit' | 'complete' | 'continue'

/** Exit cleanly at an animation's waiting pose, then finish at its exit pose. */
export function animationStateAction(state: number): AnimationStateAction {
  if (state === 1) return 'request-exit'
  if (state === 0) return 'complete'
  return 'continue'
}

/** Replay only speech that first arrived hidden, never an already visible balloon. */
export function pendingSpeechToReplay(
  activeSpeech: string | undefined,
  pendingSpeech: string | undefined,
): string | undefined {
  return activeSpeech === undefined ? pendingSpeech : undefined
}

/** Start immediately when idle; otherwise retain only the newest requested state. */
export function requestActivityPlayback(
  state: ActivityPlaybackState,
  activity: PlayableActivity,
): ActivityPlaybackTransition {
  if (state.active === undefined) return { state: { active: activity }, start: activity }
  if (state.active === activity) {
    return state.pending === undefined ? { state } : { state: { active: activity } }
  }
  return { state: { active: state.active, pending: activity }, exitActive: true }
}

/** Advance only the animation that actually completed, ignoring stale callbacks. */
export function completeActivityPlayback(
  state: ActivityPlaybackState,
  activity: PlayableActivity,
): ActivityPlaybackTransition {
  if (state.active !== activity) return { state }
  if (state.pending === undefined || state.pending === activity) return { state: EMPTY_ACTIVITY_PLAYBACK }
  return { state: { active: state.pending }, start: state.pending }
}

/** An idle transition drops stale queued work before requesting the active animation's exit. */
export function clearPendingActivity(state: ActivityPlaybackState): ActivityPlaybackState {
  return state.active === undefined ? EMPTY_ACTIVITY_PLAYBACK : { active: state.active }
}

export function pageIsActive(visibilityState: DocumentVisibilityState, hasFocus: boolean): boolean {
  return visibilityState === 'visible' && hasFocus
}
