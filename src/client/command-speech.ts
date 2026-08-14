/** Historical-safe projection of successful /clippy command output. */
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

export interface CommandSpeechCursor {
  readonly hydrated: boolean
  readonly lastCommandId?: string
}

export interface CommandSpeechUpdate {
  readonly cursor: CommandSpeechCursor
  readonly text?: string
}

function completedClippyCommand(snapshot: ConversationSnapshot): { id: string; text: string } | undefined {
  for (let index = snapshot.nodes.length - 1; index >= 0; index -= 1) {
    const node = snapshot.nodes[index]
    if (node?.kind !== 'command' || node.name !== 'clippy' || node.outcome?.kind !== 'success') continue
    const text = node.outcome.text?.trim()
    if (text !== undefined && text !== '') return { id: String(node.commandId), text }
  }
  return undefined
}

/**
 * Advance one session's command cursor. A newly selected session first opens
 * with an empty cold/loading snapshot, so its first complete history must be
 * baselined rather than mistaken for a command that just finished live.
 */
export function commandSpeechUpdate(
  snapshot: ConversationSnapshot,
  cursor: CommandSpeechCursor,
): CommandSpeechUpdate {
  if (!cursor.hydrated) {
    if (snapshot.openState !== 'open') return { cursor }
    const historical = completedClippyCommand(snapshot)
    return {
      cursor: historical === undefined
        ? { hydrated: true }
        : { hydrated: true, lastCommandId: historical.id },
    }
  }

  const command = completedClippyCommand(snapshot)
  if (command === undefined || command.id === cursor.lastCommandId) return { cursor }
  return {
    cursor: { hydrated: true, lastCommandId: command.id },
    text: command.text,
  }
}
