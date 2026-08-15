/** Global Clippy companion for the Dsh web client. */
import type { ClientContext, ConversationSnapshot, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { initAgent } from 'clippyjs'
import Clippy from 'clippyjs/agents/clippy'
import { ACTIVITY_ANIMATION, activityInput, deriveActivity, type ClippyActivity } from './activity.ts'
import { commandSpeechUpdate, type CommandSpeechCursor } from './command-speech.ts'
import {
  chooseIdleAmbient,
  chooseIdleFlourish,
  idleAmbientDelay,
  idleFlourishDelay,
  IDLE_SETTLE_SEQUENCE,
  type IdleAmbient,
  type IdleFlourish,
} from './idle.ts'
import {
  animationStateAction,
  clearPendingActivity,
  completeActivityPlayback,
  EMPTY_ACTIVITY_PLAYBACK,
  pageIsActive,
  pendingSpeechToReplay,
  requestActivityPlayback,
  type ActivityPlaybackState,
  type PlayableActivity,
} from './playback.ts'

export const inject = ['sessions']

const COMPLETE_RESET_MS = 5_500
const ANIMATION_SAFETY_MS = 15_000
const SPEECH_HOLD_MS = 15_000
const AUTO_MIN_MS = 8 * 60_000
const AUTO_MAX_MS = 20 * 60_000
const CLIPPY_GENERATE_PATH = '/api/clippy/generate'

type ClippyAgent = Awaited<ReturnType<typeof initAgent>>

/** Put the assistant near the lower-right edge without reaching into its internals. */
function place(agent: ClippyAgent): void {
  agent.moveTo(Math.max(5, window.innerWidth - 145), Math.max(5, window.innerHeight - 115), 0)
}

function randomAutoDelay(): number {
  return AUTO_MIN_MS + Math.floor(Math.random() * (AUTO_MAX_MS - AUTO_MIN_MS + 1))
}

function responseText(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Clippy endpoint returned a non-object')
  }
  const text = (value as { text?: unknown }).text
  if (typeof text !== 'string' || text.trim() === '') throw new Error('Clippy endpoint returned no text')
  return text
}

function automaticFailureCategory(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'aborted'
  if (!(error instanceof Error)) return 'unknown'
  const status = error.message.match(/endpoint failed:\s*(\d{3})/u)?.[1]
  if (status !== undefined) return `http-${status}`
  if (/non-object|no text/iu.test(error.message)) return 'invalid-response'
  if (/JSON/iu.test(error.message)) return 'invalid-json'
  return 'network'
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    // The host and browser runtimes both augment Context with a service named
    // `sessions`, but they expose different interfaces. This module runs only
    // in the browser, where the client session projection is authoritative.
    const sessions = (ctx as unknown as { readonly sessions: ISessions }).sessions
    let disposed = false
    let agent: ClippyAgent | undefined
    let currentSession: SessionId | undefined
    let disposeSession: (() => void) | undefined
    let resetTimer: number | undefined
    let animationTimer: number | undefined
    let speechTimer: number | undefined
    let autoTimer: number | undefined
    let idleTimer: number | undefined
    let ambientTimer: number | undefined
    let autoRequest: AbortController | undefined
    let lastSnapshot: ConversationSnapshot | undefined
    let lastActivity: ClippyActivity = 'idle'
    let commandCursor: CommandSpeechCursor = { hydrated: false }
    let pendingSpeech: string | undefined
    let activeSpeech: string | undefined
    let lastIdleFlourish: IdleFlourish | undefined
    let lastIdleAmbient: IdleAmbient | undefined
    let pendingIdleAmbient: IdleAmbient | undefined
    let activityPlayback: ActivityPlaybackState = EMPTY_ACTIVITY_PLAYBACK
    let activityGeneration = 0
    let idleAnimationActive = false

    const clearTimers = (): void => {
      if (resetTimer !== undefined) window.clearTimeout(resetTimer)
      resetTimer = undefined
    }

    const clearAnimationTimer = (): void => {
      if (animationTimer !== undefined) window.clearTimeout(animationTimer)
      animationTimer = undefined
    }

    const clearAutoTimer = (): void => {
      if (autoTimer !== undefined) window.clearTimeout(autoTimer)
      autoTimer = undefined
    }

    const clearIdleTimer = (): void => {
      if (idleTimer !== undefined) window.clearTimeout(idleTimer)
      idleTimer = undefined
    }

    const clearAmbientTimer = (): void => {
      if (ambientTimer !== undefined) window.clearTimeout(ambientTimer)
      ambientTimer = undefined
    }

    const clearSpeechTimer = (): void => {
      if (speechTimer !== undefined) window.clearTimeout(speechTimer)
      speechTimer = undefined
    }

    const stopPlayback = (): void => {
      clearAnimationTimer()
      clearAmbientTimer()
      activityGeneration += 1
      activityPlayback = EMPTY_ACTIVITY_PLAYBACK
      idleAnimationActive = false
      pendingIdleAmbient = undefined
      // clippyjs's public Queue cannot cancel its active item. Drive the
      // bundled animator directly so a stale queued action cannot block the
      // next state or speech balloon.
      agent?._queue.clear()
      agent?._animator.exitAnimation()
    }

    const releaseSpeech = (): void => {
      clearSpeechTimer()
      if (activeSpeech !== undefined) {
        const balloon = agent?._balloon
        if (balloon !== undefined) {
          if (balloon._loop !== undefined) window.clearTimeout(balloon._loop)
          if (balloon._hiding !== null) window.clearTimeout(balloon._hiding)
          balloon._loop = undefined
          balloon._hiding = null
          balloon._active = false
          balloon._hold = false
          balloon.hide(true)
        }
      }
      activeSpeech = undefined
    }

    const cancelSpeech = (): void => {
      releaseSpeech()
      stopPlayback()
    }

    const abortAutoRequest = (): void => {
      autoRequest?.abort(new Error('Clippy automatic trigger cancelled'))
      autoRequest = undefined
    }

    const say = (text: string): void => {
      clearAutoTimer()
      clearIdleTimer()
      clearAmbientTimer()
      if (agent === undefined || !pageIsActive(document.visibilityState, document.hasFocus())) {
        pendingSpeech = text
        return
      }
      pendingSpeech = undefined
      cancelSpeech()
      activeSpeech = text
      // speak() is queue-backed and can sit forever behind a stuck active
      // animation. The bundled Balloon API is synchronous and independent.
      agent._balloon.speak(() => {}, text, true)
      speechTimer = window.setTimeout(() => {
        releaseSpeech()
        if (agent !== undefined && pageIsActive(document.visibilityState, document.hasFocus())) {
          if (lastActivity !== 'idle') play(lastActivity)
          else resumeIdleSequence()
        }
        scheduleIdleFlourish()
      }, SPEECH_HOLD_MS)
    }

    let scheduleAmbientIdle = (): void => {}

    const resumeIdle = (preferred?: IdleAmbient, followup?: IdleAmbient): void => {
      if (agent === undefined || activityPlayback.active !== undefined || speechTimer !== undefined
        || idleAnimationActive || !pageIsActive(document.visibilityState, document.hasFocus())) return
      // clippy.js plays one idle action and leaves its final frame parked while
      // retaining the Idle name. Start and track a fresh quiet action directly.
      clearAmbientTimer()
      activityGeneration += 1
      clearAnimationTimer()
      agent._queue.clear()
      lastIdleAmbient = preferred ?? chooseIdleAmbient(lastIdleAmbient, Math.random())
      pendingIdleAmbient = followup
      idleAnimationActive = agent._animator.showAnimation(
        lastIdleAmbient,
        agent._onIdleComplete.bind(agent),
      )
      if (!idleAnimationActive) {
        pendingIdleAmbient = undefined
        console.warn('[dsh-clippy] idle animation unavailable')
        scheduleAmbientIdle()
      }
    }

    const resumeIdleSequence = (): void => {
      resumeIdle(IDLE_SETTLE_SEQUENCE[0], IDLE_SETTLE_SEQUENCE[1])
    }

    const beginActivity = (activity: PlayableActivity): void => {
      if (agent === undefined || speechTimer !== undefined
        || !pageIsActive(document.visibilityState, document.hasFocus())) return
      const generation = ++activityGeneration
      clearAnimationTimer()
      clearAmbientTimer()
      agent._queue.clear()
      idleAnimationActive = false
      pendingIdleAmbient = undefined
      let finished = false
      const finish = (): void => {
        if (finished || generation !== activityGeneration) return
        finished = true
        clearAnimationTimer()
        if (generation !== activityGeneration) return
        const transition = completeActivityPlayback(activityPlayback, activity)
        activityPlayback = transition.state
        if (transition.start !== undefined) {
          const next = transition.start
          window.setTimeout(() => {
            if (generation === activityGeneration && activityPlayback.active === next) beginActivity(next)
          }, 0)
        } else {
          resumeIdleSequence()
        }
      }
      const started = agent._animator.showAnimation(ACTIVITY_ANIMATION[activity], (_name: string, state: number) => {
        const action = animationStateAction(state)
        if (action === 'request-exit') agent?._animator.exitAnimation()
        else if (action === 'complete') finish()
      })
      if (!started) {
        console.warn(`[dsh-clippy] activity animation unavailable: ${activity}`)
        activityPlayback = EMPTY_ACTIVITY_PLAYBACK
        resumeIdle()
        return
      }
      animationTimer = window.setTimeout(() => agent?._animator.exitAnimation(), ANIMATION_SAFETY_MS)
    }

    const play = (activity: ClippyActivity): void => {
      if (agent === undefined || activity === 'idle' || speechTimer !== undefined
        || !pageIsActive(document.visibilityState, document.hasFocus())) return
      const transition = requestActivityPlayback(activityPlayback, activity)
      activityPlayback = transition.state
      if (transition.start !== undefined) beginActivity(transition.start)
    }

    let scheduleAuto = (): void => {}
    let scheduleIdleFlourish = (): void => {}

    scheduleAmbientIdle = (): void => {
      if (ambientTimer !== undefined || agent === undefined || idleAnimationActive
        || activityPlayback.active !== undefined || speechTimer !== undefined
        || !pageIsActive(document.visibilityState, document.hasFocus())) return
      ambientTimer = window.setTimeout(() => {
        ambientTimer = undefined
        resumeIdle()
      }, idleAmbientDelay(Math.random()))
    }

    const playIdleFlourish = (): void => {
      idleTimer = undefined
      if (agent === undefined || lastActivity !== 'idle' || speechTimer !== undefined
        || activityPlayback.active !== undefined || idleAnimationActive
        || !pageIsActive(document.visibilityState, document.hasFocus())) {
        scheduleIdleFlourish()
        return
      }
      lastIdleFlourish = chooseIdleFlourish(lastIdleFlourish, Math.random())
      const generation = ++activityGeneration
      let finished = false
      clearAnimationTimer()
      clearAmbientTimer()
      agent._queue.clear()
      idleAnimationActive = false
      pendingIdleAmbient = undefined
      const started = agent._animator.showAnimation(lastIdleFlourish, (_name: string, state: number) => {
        if (finished || generation !== activityGeneration) return
        const action = animationStateAction(state)
        if (action === 'request-exit') {
          agent?._animator.exitAnimation()
        } else if (action === 'complete') {
          finished = true
          clearAnimationTimer()
          idleAnimationActive = false
          resumeIdleSequence()
        }
      })
      if (started) {
        idleAnimationActive = true
        animationTimer = window.setTimeout(() => agent?._animator.exitAnimation(), ANIMATION_SAFETY_MS)
      } else {
        console.warn('[dsh-clippy] idle flourish unavailable')
        resumeIdleSequence()
      }
      scheduleIdleFlourish()
    }

    scheduleIdleFlourish = (): void => {
      if (idleTimer !== undefined || agent === undefined || lastActivity !== 'idle'
        || speechTimer !== undefined || activityPlayback.active !== undefined
        || !pageIsActive(document.visibilityState, document.hasFocus())) return
      idleTimer = window.setTimeout(playIdleFlourish, idleFlourishDelay(Math.random()))
    }

    const generateAutomatically = async (): Promise<void> => {
      autoTimer = undefined
      const sessionId = currentSession
      if (sessionId === undefined || lastSnapshot?.running !== false
        || !pageIsActive(document.visibilityState, document.hasFocus()) || autoRequest !== undefined) {
        scheduleAuto()
        return
      }
      const controller = new AbortController()
      autoRequest = controller
      try {
        const response = await fetch(CLIPPY_GENERATE_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
          signal: controller.signal,
        })
        if (response.status === 409) return // The host won the idle/running race.
        if (!response.ok) throw new Error(`Clippy endpoint failed: ${response.status}`)
        const text = responseText(await response.json())
        if (currentSession === sessionId) say(text)
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          console.warn(`[dsh-clippy] automatic response unavailable: ${automaticFailureCategory(error)}`)
        }
      } finally {
        if (autoRequest === controller) autoRequest = undefined
        scheduleAuto()
      }
    }

    scheduleAuto = (): void => {
      if (autoTimer !== undefined || autoRequest !== undefined || agent === undefined
        || currentSession === undefined || lastSnapshot?.running !== false
        || !pageIsActive(document.visibilityState, document.hasFocus())) return
      autoTimer = window.setTimeout(() => { void generateAutomatically() }, randomAutoDelay())
    }

    const observeManualCommand = (snapshot: ConversationSnapshot): void => {
      const update = commandSpeechUpdate(snapshot, commandCursor)
      commandCursor = update.cursor
      if (update.text === undefined) return
      say(update.text)
      scheduleAuto()
    }

    const project = (snapshot: ConversationSnapshot): void => {
      const wasRunning = lastSnapshot?.running ?? false
      const next = deriveActivity(activityInput(snapshot), wasRunning)
      lastSnapshot = snapshot
      clearTimers()
      clearIdleTimer()
      clearAmbientTimer()
      observeManualCommand(snapshot)

      if (next !== lastActivity || next === 'done' || next === 'error') play(next)
      lastActivity = next

      if (snapshot.running) {
        clearAutoTimer()
        abortAutoRequest()
      } else if (next === 'done' || next === 'error') {
        resetTimer = window.setTimeout(() => {
          lastActivity = 'idle'
          activityPlayback = clearPendingActivity(activityPlayback)
          resumeIdleSequence()
          scheduleIdleFlourish()
        }, COMPLETE_RESET_MS)
      }
      if (next === 'idle') {
        activityPlayback = clearPendingActivity(activityPlayback)
        resumeIdleSequence()
        scheduleIdleFlourish()
      }
      if (!snapshot.running) scheduleAuto()
    }

    const bindCurrentSession = (): void => {
      const nextSession = sessions.list.getSnapshot().current
      if (nextSession === currentSession) return

      disposeSession?.()
      disposeSession = undefined
      currentSession = nextSession
      lastSnapshot = undefined
      lastActivity = 'idle'
      commandCursor = { hydrated: false }
      clearTimers()
      cancelSpeech()
      clearAutoTimer()
      clearIdleTimer()
      clearAmbientTimer()
      abortAutoRequest()

      if (nextSession === undefined) return
      const session = sessions.binding(nextSession)?.session
      if (session === undefined) return
      const initial = session.getSnapshot()
      project(initial)
      disposeSession = session.subscribe(() => project(session.getSnapshot()))
    }

    const onPageActivity = (): void => {
      if (agent === undefined) return
      if (pageIsActive(document.visibilityState, document.hasFocus())) {
        agent.resume()
        place(agent)
        const speechToReplay = pendingSpeechToReplay(activeSpeech, pendingSpeech)
        if (speechToReplay !== undefined) {
          say(speechToReplay)
        } else if (activeSpeech !== undefined) {
          // The same balloon remains active; agent.resume() continues its
          // word animation without starting a new speech instance.
        } else if (lastActivity !== 'idle') {
          play(lastActivity)
        } else {
          resumeIdleSequence()
        }
        scheduleAuto()
        scheduleIdleFlourish()
      } else {
        clearAutoTimer()
        clearIdleTimer()
        clearAmbientTimer()
        abortAutoRequest()
        agent.pause()
      }
    }

    const disposeList = sessions.list.subscribe(bindCurrentSession)
    bindCurrentSession()
    document.addEventListener('visibilitychange', onPageActivity)
    window.addEventListener('focus', onPageActivity)
    window.addEventListener('blur', onPageActivity)

    // Load the authentic Clippit atlas/data but deliberately omit sounds: an
    // activity indicator should never produce surprise audio.
    void initAgent({
      ...Clippy,
      sound: async () => ({ default: {} }),
    }).then((loaded) => {
      if (disposed) {
        loaded.dispose()
        return
      }
      agent = loaded
      const completeNativeIdle = agent._onIdleComplete.bind(agent)
      agent._onIdleComplete = (animation: string, state: number): void => {
        completeNativeIdle(animation, state)
        if (state !== 0) return
        idleAnimationActive = false
        const followup = pendingIdleAmbient
        pendingIdleAmbient = undefined
        if (disposed) return
        if (followup !== undefined) resumeIdle(followup)
        else scheduleAmbientIdle()
      }
      // A zero-duration move completes synchronously while hidden. Doing it
      // before show avoids Clippy's idle queue delaying initial placement.
      place(agent)
      agent.show(true)
      // Replace clippy.js's untracked one-shot startup idle with a guaranteed
      // visible, lifecycle-tracked quiet motion.
      idleAnimationActive = false
      if (!pageIsActive(document.visibilityState, document.hasFocus())) {
        agent.pause()
        return
      }
      if (pendingSpeech !== undefined) {
        say(pendingSpeech)
      } else if (lastActivity !== 'idle') {
        play(lastActivity)
      } else {
        resumeIdleSequence()
      }
      scheduleAuto()
      scheduleIdleFlourish()
    }).catch(() => {
      if (!disposed) console.warn('[dsh-clippy] avatar unavailable')
    })

    return () => {
      disposed = true
      clearTimers()
      cancelSpeech()
      clearAutoTimer()
      clearIdleTimer()
      clearAmbientTimer()
      abortAutoRequest()
      disposeSession?.()
      disposeList()
      document.removeEventListener('visibilitychange', onPageActivity)
      window.removeEventListener('focus', onPageActivity)
      window.removeEventListener('blur', onPageActivity)
      agent?.dispose()
      agent = undefined
    }
  }, 'clippy: global activity avatar')
}
