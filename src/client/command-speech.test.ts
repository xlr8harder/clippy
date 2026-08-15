import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it } from 'vitest'
import { clippyCommandRunning, commandSpeechUpdate, type CommandSpeechCursor } from './command-speech.ts'

function snapshot(
  openState: ConversationSnapshot['openState'],
  commands: Array<{ id: string; text?: string; outcome?: 'success' | 'error' }> = [],
): ConversationSnapshot {
  return {
    openState,
    nodes: commands.map((command, seq) => ({
      kind: 'command' as const,
      seq,
      time: seq,
      commandId: command.id as never,
      name: 'clippy',
      args: '',
      outcome: command.outcome === undefined
        ? null
        : { kind: command.outcome, ...(command.text === undefined ? {} : { text: command.text }) },
    })),
  } as ConversationSnapshot
}

describe('commandSpeechUpdate', () => {
  it('distinguishes a generating /clippy command from its completed history', () => {
    expect(clippyCommandRunning(snapshot('open', [{ id: 'running' }]))).toBe(true)
    expect(clippyCommandRunning(snapshot('open', [{ id: 'done', outcome: 'success', text: 'ready' }]))).toBe(false)
  })

  it('baselines command history only after a newly selected session is open', () => {
    const cold: CommandSpeechCursor = { hydrated: false }
    const loading = commandSpeechUpdate(snapshot('loading'), cold)
    expect(loading).toEqual({ cursor: cold })

    const opened = commandSpeechUpdate(snapshot('open', [{
      id: 'historical', text: 'old balloon', outcome: 'success',
    }]), loading.cursor)
    expect(opened).toEqual({ cursor: { hydrated: true, lastCommandId: 'historical' } })
  })

  it('speaks a newly completed successful command exactly once', () => {
    const ready = commandSpeechUpdate(snapshot('open'), { hydrated: false }).cursor
    const running = commandSpeechUpdate(snapshot('open', [{ id: 'new' }]), ready)
    expect(running.text).toBeUndefined()

    const completed = commandSpeechUpdate(snapshot('open', [{
      id: 'new', text: 'new balloon', outcome: 'success',
    }]), running.cursor)
    expect(completed.text).toBe('new balloon')
    expect(commandSpeechUpdate(snapshot('open', [{
      id: 'new', text: 'new balloon', outcome: 'success',
    }]), completed.cursor).text).toBeUndefined()
  })

  it('does not speak failed or empty successful commands', () => {
    const ready: CommandSpeechCursor = { hydrated: true }
    expect(commandSpeechUpdate(snapshot('open', [{
      id: 'failed', text: 'failure', outcome: 'error',
    }]), ready).text).toBeUndefined()
    expect(commandSpeechUpdate(snapshot('open', [{
      id: 'empty', text: '  ', outcome: 'success',
    }]), ready).text).toBeUndefined()
  })
})
