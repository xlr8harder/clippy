import type { ClippyActivity } from './activity.ts'

export type PlayableActivity = Exclude<ClippyActivity, 'idle'>

export interface ActivityPlaybackState {
  readonly active?: PlayableActivity
  readonly pending?: PlayableActivity
}

export interface ActivityPlaybackTransition {
  readonly state: ActivityPlaybackState
  readonly start?: PlayableActivity
}

export const EMPTY_ACTIVITY_PLAYBACK: ActivityPlaybackState = Object.freeze({})

/** Start immediately when idle; otherwise retain only the newest requested state. */
export function requestActivityPlayback(
  state: ActivityPlaybackState,
  activity: PlayableActivity,
): ActivityPlaybackTransition {
  if (state.active === undefined) return { state: { active: activity }, start: activity }
  if (state.active === activity) return { state }
  return { state: { active: state.active, pending: activity } }
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

/** An idle transition lets the current animation finish but drops stale queued work. */
export function clearPendingActivity(state: ActivityPlaybackState): ActivityPlaybackState {
  return state.active === undefined ? EMPTY_ACTIVITY_PLAYBACK : { active: state.active }
}

export function pageIsActive(visibilityState: DocumentVisibilityState, hasFocus: boolean): boolean {
  return visibilityState === 'visible' && hasFocus
}
