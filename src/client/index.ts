/** Global Clippy companion for the Dsh web client. */
import type { ClientContext, ConversationSnapshot, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { initAgent } from 'clippyjs'
import Clippy from 'clippyjs/agents/clippy'
import { ACTIVITY_ANIMATION, activityInput, deriveActivity, type ClippyActivity } from './activity.ts'
import { commandSpeechUpdate, type CommandSpeechCursor } from './command-speech.ts'

export const inject = ['sessions']

const ACTIVE_REPEAT_MS = 5_000
const COMPLETE_RESET_MS = 5_500
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
    let repeatTimer: number | undefined
    let resetTimer: number | undefined
    let autoTimer: number | undefined
    let autoRequest: AbortController | undefined
    let lastSnapshot: ConversationSnapshot | undefined
    let lastActivity: ClippyActivity = 'idle'
    let commandCursor: CommandSpeechCursor = { hydrated: false }
    let pendingSpeech: string | undefined

    const clearTimers = (): void => {
      if (repeatTimer !== undefined) window.clearInterval(repeatTimer)
      if (resetTimer !== undefined) window.clearTimeout(resetTimer)
      repeatTimer = undefined
      resetTimer = undefined
    }

    const clearAutoTimer = (): void => {
      if (autoTimer !== undefined) window.clearTimeout(autoTimer)
      autoTimer = undefined
    }

    const abortAutoRequest = (): void => {
      autoRequest?.abort(new Error('Clippy automatic trigger cancelled'))
      autoRequest = undefined
    }

    const say = (text: string): void => {
      clearAutoTimer()
      if (agent === undefined || document.visibilityState !== 'visible') {
        pendingSpeech = text
        return
      }
      pendingSpeech = undefined
      agent.stop()
      agent.speak(text, false)
    }

    const play = (activity: ClippyActivity): void => {
      if (agent === undefined || activity === 'idle' || document.visibilityState !== 'visible') return
      const animation = ACTIVITY_ANIMATION[activity]
      agent.stop()
      agent.play(animation)
    }

    let scheduleAuto = (): void => {}

    const generateAutomatically = async (): Promise<void> => {
      autoTimer = undefined
      const sessionId = currentSession
      if (sessionId === undefined || lastSnapshot?.running !== false
        || document.visibilityState !== 'visible' || autoRequest !== undefined) {
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
        if (currentSession === sessionId && document.visibilityState === 'visible') say(text)
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          console.error('[dsh-clippy] automatic response failed', error)
        }
      } finally {
        if (autoRequest === controller) autoRequest = undefined
        scheduleAuto()
      }
    }

    scheduleAuto = (): void => {
      if (autoTimer !== undefined || autoRequest !== undefined || agent === undefined
        || currentSession === undefined || lastSnapshot?.running !== false
        || document.visibilityState !== 'visible') return
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
      observeManualCommand(snapshot)

      if (next !== lastActivity || next === 'done' || next === 'error') play(next)
      lastActivity = next

      if (snapshot.running) {
        clearAutoTimer()
        abortAutoRequest()
        repeatTimer = window.setInterval(() => play(lastActivity), ACTIVE_REPEAT_MS)
      } else if (next === 'done' || next === 'error') {
        resetTimer = window.setTimeout(() => { lastActivity = 'idle' }, COMPLETE_RESET_MS)
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
      clearAutoTimer()
      abortAutoRequest()

      if (nextSession === undefined) return
      const session = sessions.binding(nextSession)?.session
      if (session === undefined) return
      const initial = session.getSnapshot()
      project(initial)
      disposeSession = session.subscribe(() => project(session.getSnapshot()))
    }

    const onVisibility = (): void => {
      if (agent === undefined) return
      if (document.visibilityState === 'visible') {
        agent.resume()
        place(agent)
        if (pendingSpeech !== undefined) {
          say(pendingSpeech)
        } else if (lastActivity !== 'idle') {
          play(lastActivity)
        }
        scheduleAuto()
      } else {
        clearAutoTimer()
        abortAutoRequest()
        agent.pause()
      }
    }

    const disposeList = sessions.list.subscribe(bindCurrentSession)
    bindCurrentSession()
    document.addEventListener('visibilitychange', onVisibility)

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
      // A zero-duration move completes synchronously while hidden. Doing it
      // before show avoids Clippy's idle queue delaying initial placement.
      place(agent)
      agent.show(true)
      agent.play('Greeting')
      if (pendingSpeech !== undefined) {
        say(pendingSpeech)
      } else if (lastActivity !== 'idle') {
        play(lastActivity)
      }
      scheduleAuto()
    }).catch((error: unknown) => {
      if (!disposed) console.error('[dsh-clippy] failed to load avatar', error)
    })

    return () => {
      disposed = true
      clearTimers()
      clearAutoTimer()
      abortAutoRequest()
      disposeSession?.()
      disposeList()
      document.removeEventListener('visibilitychange', onVisibility)
      agent?.dispose()
      agent = undefined
    }
  }, 'clippy: global activity avatar')
}
