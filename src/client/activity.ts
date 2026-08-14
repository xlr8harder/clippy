import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

/** Small, stable projection from the full conversation snapshot to avatar behavior. */
export type ClippyActivity = 'idle' | 'thinking' | 'writing' | 'tool' | 'waiting' | 'done' | 'error'

export interface ActivityInput {
  readonly running: boolean
  readonly hasPartial: boolean
  readonly runningCallCount: number
  readonly pendingCount: number
  readonly lastAgentError: string | null
}

export function activityInput(snapshot: ConversationSnapshot): ActivityInput {
  return {
    running: snapshot.running,
    hasPartial: snapshot.partial !== null,
    runningCallCount: snapshot.runningCalls.length,
    pendingCount: snapshot.pending.length,
    lastAgentError: snapshot.lastAgentError,
  }
}

/**
 * Derive the next visible state. Completion/error are transition states: they
 * only fire when a running turn settles, then naturally return to idle.
 */
export function deriveActivity(input: ActivityInput, wasRunning: boolean): ClippyActivity {
  if (input.runningCallCount > 0) return 'tool'
  if (input.running && input.hasPartial) return 'writing'
  if (input.running) return 'thinking'
  if (wasRunning && input.lastAgentError !== null) return 'error'
  if (wasRunning) return 'done'
  if (input.pendingCount > 0) return 'waiting'
  return 'idle'
}

/** Named animations present in the Clippit animation table. */
export const ACTIVITY_ANIMATION: Readonly<Record<Exclude<ClippyActivity, 'idle'>, string>> = {
  thinking: 'Thinking',
  writing: 'Writing',
  tool: 'Searching',
  waiting: 'GetAttention',
  done: 'Congratulate',
  error: 'Alert',
}
