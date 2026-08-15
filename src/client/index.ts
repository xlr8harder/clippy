/** Global Clippy companion for the Dsh web client. */
import type { ClientContext, ConversationSnapshot, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { initAgent } from 'clippyjs'
import Clippy from 'clippyjs/agents/clippy'
import { ACTIVITY_ANIMATION, activityInput, deriveActivity, type ClippyActivity } from './activity.ts'
import { automaticActivityStamp } from './auto.ts'
import { clippyCommandRunning, commandSpeechUpdate, type CommandSpeechCursor } from './command-speech.ts'
import {
  chooseIdleAmbient,
  chooseIdleFlourish,
  idleAmbientDelay,
  idleFlourishDelay,
  IDLE_AMBIENT_WATCHDOG_MS,
  IDLE_SETTLE_ANIMATION,
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
const ACTIVITY_PLAY_MS = 5_000
const ACTIVITY_EXIT_GRACE_MS = 1_500
const FLOURISH_PLAY_MS = 15_000
const SPEECH_FINISHED_HOLD_MS = 5_000
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
    let speechTransitionTimer: number | undefined
    let autoTimer: number | undefined
    let idleTimer: number | undefined
    let ambientTimer: number | undefined
    let idleWatchdogTimer: number | undefined
    let activationTimer: number | undefined
    let activationRetries = 0
    let autoRequest: AbortController | undefined
    let lastSnapshot: ConversationSnapshot | undefined
    let lastActivity: ClippyActivity = 'idle'
    let commandCursor: CommandSpeechCursor = { hydrated: false }
    let pendingSpeech: string | undefined
    let activeSpeech: string | undefined
    let lastIdleFlourish: IdleFlourish | undefined
    let lastIdleAmbient: IdleAmbient | undefined
    let activityPlayback: ActivityPlaybackState = EMPTY_ACTIVITY_PLAYBACK
    let activityGeneration = 0
    let activityExit: (() => void) | undefined
    let idleAnimationActive = false
    let speechGeneration = 0
    let speechAnimationPaused = false
    let pagePlaybackPaused = false
    const lastAutomaticStampBySession = new Map<string, string>()

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
      if (idleWatchdogTimer !== undefined) window.clearTimeout(idleWatchdogTimer)
      idleWatchdogTimer = undefined
    }

    const clearSpeechTimer = (): void => {
      if (speechTimer !== undefined) window.clearTimeout(speechTimer)
      speechTimer = undefined
    }

    const clearSpeechTransitionTimer = (): void => {
      if (speechTransitionTimer !== undefined) window.clearTimeout(speechTransitionTimer)
      speechTransitionTimer = undefined
    }

    const clearActivationTimer = (): void => {
      if (activationTimer !== undefined) window.clearTimeout(activationTimer)
      activationTimer = undefined
    }

    const retryInitialActivation = (): void => {
      if (activationTimer !== undefined || activationRetries >= 8) return
      activationRetries += 1
      activationTimer = window.setTimeout(() => {
        activationTimer = undefined
        if (pageIsActive(document.visibilityState, document.hasFocus())) {
          activationRetries = 0
          onPageActivity()
        } else {
          retryInitialActivation()
        }
      }, 250)
    }

    const stopPlayback = (): void => {
      clearAnimationTimer()
      clearAmbientTimer()
      activityGeneration += 1
      activityExit = undefined
      activityPlayback = EMPTY_ACTIVITY_PLAYBACK
      idleAnimationActive = false
      // clippyjs's public Queue cannot cancel its active item. Drive the
      // bundled animator directly so a stale queued action cannot block the
      // next state or speech balloon.
      agent?._queue.clear()
      agent?._animator.exitAnimation()
    }

    const releaseSpeech = (): void => {
      speechGeneration += 1
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

    const restoreAnimatorAfterSpeech = (startPlayback?: () => void): void => {
      const shouldResume = speechAnimationPaused
      speechAnimationPaused = false
      startPlayback?.()
      if (shouldResume && !pagePlaybackPaused) agent?._animator.resume()
    }

    const freezeAnimatorForSpeech = (): void => {
      if (agent === undefined) return
      // Animator.pause() clears only its most recently recorded timeout. If a
      // host focus/resume race ever left an older step callback outstanding,
      // clearing the current animation makes every such callback a no-op too.
      agent._animator.pause()
      agent._animator._loop = undefined
      agent._animator._currentAnimation = undefined
      agent._animator._endCallback = undefined
      speechAnimationPaused = true
    }

    const cancelSpeech = (): void => {
      pendingSpeech = undefined
      clearSpeechTransitionTimer()
      releaseSpeech()
      stopPlayback()
      restoreAnimatorAfterSpeech()
    }

    const abortAutoRequest = (): void => {
      autoRequest?.abort(new Error('Clippy automatic trigger cancelled'))
      autoRequest = undefined
    }

    let startPendingSpeech = (): void => {}

    const transitionToSpeech = (): void => {
      if (pendingSpeech === undefined || agent === undefined
        || !pageIsActive(document.visibilityState, document.hasFocus())) return
      if (activityPlayback.active !== undefined) {
        activityPlayback = clearPendingActivity(activityPlayback)
        if (activityExit !== undefined) activityExit()
        else startPendingSpeech()
        return
      }
      if (idleAnimationActive) {
        agent._animator.exitAnimation()
        clearSpeechTransitionTimer()
        speechTransitionTimer = window.setTimeout(startPendingSpeech, ACTIVITY_EXIT_GRACE_MS)
        return
      }
      startPendingSpeech()
    }

    const say = (text: string): void => {
      clearIdleTimer()
      clearAmbientTimer()
      pendingSpeech = text
      if (agent === undefined || !pageIsActive(document.visibilityState, document.hasFocus())) {
        return
      }
      releaseSpeech()
      transitionToSpeech()
    }

    startPendingSpeech = (): void => {
      const text = pendingSpeech
      if (text === undefined || agent === undefined
        || !pageIsActive(document.visibilityState, document.hasFocus())) return
      pendingSpeech = undefined
      clearSpeechTransitionTimer()
      stopPlayback()
      freezeAnimatorForSpeech()
      const generation = ++speechGeneration
      activeSpeech = text
      // Agent.speak() is queue-backed and can sit forever behind a stuck
      // animation. The bundled Balloon API is synchronous and independent.
      agent._balloon.CLOSE_BALLOON_DELAY = SPEECH_FINISHED_HOLD_MS
      agent._balloon.speak(() => {
        if (generation !== speechGeneration || activeSpeech === undefined) return
        clearSpeechTimer()
        speechTimer = window.setTimeout(() => {
          if (generation !== speechGeneration) return
          releaseSpeech()
          if (agent !== undefined && pageIsActive(document.visibilityState, document.hasFocus())) {
            restoreAnimatorAfterSpeech(() => {
              if (lastActivity !== 'idle') play(lastActivity)
              else resumeIdleSettle()
            })
          }
          scheduleIdleFlourish()
        }, SPEECH_FINISHED_HOLD_MS)
      }, text, false)
    }

    let scheduleAmbientIdle = (): void => {}

    const resumeIdle = (preferred?: IdleAmbient): void => {
      if (agent === undefined || activityPlayback.active !== undefined || activeSpeech !== undefined
        || pendingSpeech !== undefined || idleAnimationActive
        || !pageIsActive(document.visibilityState, document.hasFocus())) return
      // clippy.js plays one idle action and leaves its final frame parked while
      // retaining the Idle name. Start and track a fresh quiet action directly.
      clearAmbientTimer()
      activityGeneration += 1
      clearAnimationTimer()
      agent._queue.clear()
      lastIdleAmbient = preferred ?? chooseIdleAmbient(lastIdleAmbient, Math.random())
      idleAnimationActive = agent._animator.showAnimation(
        lastIdleAmbient,
        agent._onIdleComplete.bind(agent),
      )
      if (!idleAnimationActive) {
        console.warn('[dsh-clippy] idle animation unavailable')
        scheduleAmbientIdle()
      } else {
        idleWatchdogTimer = window.setTimeout(() => {
          idleWatchdogTimer = undefined
          if (!idleAnimationActive) return
          idleAnimationActive = false
          if (lastActivity === 'idle' && activityPlayback.active === undefined
            && activeSpeech === undefined && pendingSpeech === undefined
            && pageIsActive(document.visibilityState, document.hasFocus())) {
            resumeIdleSettle()
          }
        }, IDLE_AMBIENT_WATCHDOG_MS)
      }
    }

    const resumeIdleSettle = (): void => {
      resumeIdle(IDLE_SETTLE_ANIMATION)
    }

    const beginActivity = (activity: PlayableActivity): void => {
      if (agent === undefined || activeSpeech !== undefined || pendingSpeech !== undefined
        || !pageIsActive(document.visibilityState, document.hasFocus())) return
      const generation = ++activityGeneration
      clearAnimationTimer()
      clearAmbientTimer()
      agent._queue.clear()
      idleAnimationActive = false
      let finished = false
      let exitRequested = false
      const finish = (): void => {
        if (finished || generation !== activityGeneration) return
        finished = true
        clearAnimationTimer()
        activityExit = undefined
        if (generation !== activityGeneration) return
        const transition = completeActivityPlayback(activityPlayback, activity)
        activityPlayback = transition.state
        if (pendingSpeech !== undefined) {
          activityPlayback = EMPTY_ACTIVITY_PLAYBACK
          startPendingSpeech()
          return
        }
        if (transition.start !== undefined) {
          const next = transition.start
          window.setTimeout(() => {
            if (generation === activityGeneration && activityPlayback.active === next) beginActivity(next)
          }, 0)
        } else {
          resumeIdleSettle()
        }
      }
      const requestExit = (): void => {
        if (finished || exitRequested || generation !== activityGeneration) return
        exitRequested = true
        clearAnimationTimer()
        agent?._animator.exitAnimation()
        animationTimer = window.setTimeout(finish, ACTIVITY_EXIT_GRACE_MS)
      }
      activityExit = requestExit
      const started = agent._animator.showAnimation(ACTIVITY_ANIMATION[activity], (_name: string, state: number) => {
        const action = animationStateAction(state)
        if (action === 'request-exit') requestExit()
        else if (action === 'complete') finish()
      })
      if (!started) {
        console.warn(`[dsh-clippy] activity animation unavailable: ${activity}`)
        activityExit = undefined
        activityPlayback = EMPTY_ACTIVITY_PLAYBACK
        resumeIdleSettle()
        return
      }
      animationTimer = window.setTimeout(requestExit, ACTIVITY_PLAY_MS)
    }

    const play = (activity: ClippyActivity): void => {
      if (agent === undefined || activity === 'idle' || activeSpeech !== undefined
        || pendingSpeech !== undefined
        || !pageIsActive(document.visibilityState, document.hasFocus())) return
      const transition = requestActivityPlayback(activityPlayback, activity)
      activityPlayback = transition.state
      if (transition.start !== undefined) beginActivity(transition.start)
      else if (transition.exitActive === true) activityExit?.()
    }

    const returnToIdle = (): void => {
      activityPlayback = clearPendingActivity(activityPlayback)
      if (activityPlayback.active !== undefined) activityExit?.()
      else if (!idleAnimationActive) resumeIdleSettle()
    }

    let scheduleAuto = (): void => {}
    let scheduleIdleFlourish = (): void => {}

    scheduleAmbientIdle = (): void => {
      if (ambientTimer !== undefined || agent === undefined || idleAnimationActive
        || activityPlayback.active !== undefined || activeSpeech !== undefined || pendingSpeech !== undefined
        || !pageIsActive(document.visibilityState, document.hasFocus())) return
      ambientTimer = window.setTimeout(() => {
        ambientTimer = undefined
        resumeIdle()
      }, idleAmbientDelay(Math.random()))
    }

    const playIdleFlourish = (): void => {
      idleTimer = undefined
      if (agent === undefined || lastActivity !== 'idle' || activeSpeech !== undefined
        || pendingSpeech !== undefined || activityPlayback.active !== undefined || idleAnimationActive
        || !pageIsActive(document.visibilityState, document.hasFocus())) {
        scheduleIdleFlourish()
        return
      }
      lastIdleFlourish = chooseIdleFlourish(lastIdleFlourish, Math.random())
      const generation = ++activityGeneration
      let finished = false
      let exitRequested = false
      clearAnimationTimer()
      clearAmbientTimer()
      agent._queue.clear()
      idleAnimationActive = false
      const finish = (): void => {
        if (finished || generation !== activityGeneration) return
        finished = true
        clearAnimationTimer()
        idleAnimationActive = false
        if (pendingSpeech !== undefined) {
          startPendingSpeech()
          return
        }
        resumeIdleSettle()
      }
      const requestExit = (): void => {
        if (finished || exitRequested || generation !== activityGeneration) return
        exitRequested = true
        clearAnimationTimer()
        agent?._animator.exitAnimation()
        animationTimer = window.setTimeout(finish, ACTIVITY_EXIT_GRACE_MS)
      }
      const started = agent._animator.showAnimation(lastIdleFlourish, (_name: string, state: number) => {
        if (finished || generation !== activityGeneration) return
        const action = animationStateAction(state)
        if (action === 'request-exit') requestExit()
        else if (action === 'complete') finish()
      })
      if (started) {
        idleAnimationActive = true
        animationTimer = window.setTimeout(requestExit, FLOURISH_PLAY_MS)
      } else {
        console.warn('[dsh-clippy] idle flourish unavailable')
        resumeIdleSettle()
      }
      scheduleIdleFlourish()
    }

    scheduleIdleFlourish = (): void => {
      if (idleTimer !== undefined || agent === undefined || lastActivity !== 'idle'
        || activeSpeech !== undefined || pendingSpeech !== undefined || activityPlayback.active !== undefined
        || !pageIsActive(document.visibilityState, document.hasFocus())) return
      idleTimer = window.setTimeout(playIdleFlourish, idleFlourishDelay(Math.random()))
    }

    const generateAutomatically = async (): Promise<void> => {
      autoTimer = undefined
      const sessionId = currentSession
      const snapshot = lastSnapshot
      if (sessionId === undefined || snapshot === undefined || snapshot.blank
        || !pageIsActive(document.visibilityState, document.hasFocus()) || autoRequest !== undefined) {
        scheduleAuto()
        return
      }
      const sessionKey = String(sessionId)
      const activityStamp = automaticActivityStamp(snapshot)
      if (lastAutomaticStampBySession.get(sessionKey) === activityStamp) {
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
        if (!response.ok) throw new Error(`Clippy endpoint failed: ${response.status}`)
        const text = responseText(await response.json())
        if (currentSession === sessionId) {
          lastAutomaticStampBySession.set(sessionKey, activityStamp)
          say(text)
        }
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
        || currentSession === undefined || lastSnapshot === undefined || lastSnapshot.blank
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
      const firstProjection = lastSnapshot === undefined
      const wasRunning = lastSnapshot?.running === true && !clippyCommandRunning(lastSnapshot)
      const next = deriveActivity(activityInput(snapshot), wasRunning)
      lastSnapshot = snapshot
      observeManualCommand(snapshot)

      // /clippy is commentary generation, not agent work. Preserve whichever
      // idle/activity animation is already running while the command waits.
      if (clippyCommandRunning(snapshot)) {
        return
      }

      const terminalSettling = (lastActivity === 'done' || lastActivity === 'error')
        && next === 'idle' && resetTimer !== undefined
      if ((firstProjection || next !== lastActivity) && !terminalSettling) {
        clearTimers()
        clearIdleTimer()
        clearAmbientTimer()
        lastActivity = next
        if (next === 'idle') {
          returnToIdle()
          scheduleIdleFlourish()
        } else {
          play(next)
        }
      }

      if (next === 'done' || next === 'error') {
        clearTimers()
        resetTimer = window.setTimeout(() => {
          resetTimer = undefined
          if (lastActivity !== next) return
          lastActivity = 'idle'
          returnToIdle()
          scheduleIdleFlourish()
        }, COMPLETE_RESET_MS)
      }
      scheduleAuto()
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
      clearActivationTimer()
      activationRetries = 0
      if (pageIsActive(document.visibilityState, document.hasFocus())) {
        if (pagePlaybackPaused) {
          agent.resume()
          pagePlaybackPaused = false
        }
        place(agent)
        const speechToReplay = pendingSpeechToReplay(activeSpeech, pendingSpeech)
        if (speechToReplay !== undefined) {
          say(speechToReplay)
        } else if (activeSpeech !== undefined) {
          // The same balloon remains active; agent.resume() continues its
          // word animation without starting a new speech instance.
          agent._animator.pause()
        } else if (lastActivity !== 'idle') {
          restoreAnimatorAfterSpeech(() => play(lastActivity))
        } else {
          restoreAnimatorAfterSpeech(resumeIdleSettle)
        }
        scheduleAuto()
        scheduleIdleFlourish()
      } else {
        clearAutoTimer()
        clearIdleTimer()
        clearAmbientTimer()
        abortAutoRequest()
        if (!pagePlaybackPaused) {
          agent.pause()
          pagePlaybackPaused = true
        }
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
      const showAnimation = agent._animator.showAnimation.bind(agent._animator)
      agent._animator.showAnimation = (animation, callback): boolean => {
        if (speechAnimationPaused) return false
        return showAnimation(animation, callback)
      }
      const completeNativeIdle = agent._onIdleComplete.bind(agent)
      agent._onIdleComplete = (animation: string, state: number): void => {
        completeNativeIdle(animation, state)
        if (state !== 0) return
        if (idleWatchdogTimer !== undefined) window.clearTimeout(idleWatchdogTimer)
        idleWatchdogTimer = undefined
        idleAnimationActive = false
        if (disposed) return
        if (pendingSpeech !== undefined) {
          startPendingSpeech()
          return
        }
        scheduleAmbientIdle()
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
        pagePlaybackPaused = true
        // initAgent can resolve just before the newly opened page acquires
        // focus, and that initial acquisition does not reliably emit focus.
        // Recheck briefly rather than leaving the animator paused indefinitely.
        retryInitialActivation()
        return
      }
      if (pendingSpeech !== undefined) {
        say(pendingSpeech)
      } else if (lastActivity !== 'idle') {
        play(lastActivity)
      } else {
        resumeIdleSettle()
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
      clearActivationTimer()
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
