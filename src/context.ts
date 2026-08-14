/** Bounded, model-facing evidence distilled from one live Dsh session. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const MAX_MESSAGES = 14
const MAX_MESSAGE_CHARS = 2_400
const MAX_CONTEXT_CHARS = 22_000
const MAX_TOOLS = 12
const MAX_TOOL_ARGUMENT_CHARS = 1_200
const MAX_TOOL_RESULT_CHARS = 1_800
const MAX_ERRORS = 8
const MAX_ERROR_CHARS = 800
const MAX_EVENT_SCAN = 240
const ACTIVITY_GAP_MS = 30 * 60_000

export interface ClippyEvidenceMessage {
  readonly role: Message['role']
  readonly text: string
}

export interface ClippyToolEvidence {
  readonly name: string
  readonly arguments: string
  readonly outcome: 'running' | 'success' | 'error'
  readonly resultExcerpt?: string
}

export interface ClippyEvidence {
  readonly cwd?: string
  readonly activityMinutes: number
  readonly recentMessages: readonly ClippyEvidenceMessage[]
  readonly recentTools: readonly ClippyToolEvidence[]
  readonly recentErrors: readonly string[]
  readonly omittedEarlierContext: boolean
}

function truncate(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`
}

function contentText(blocks: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        parts.push(block.text)
        break
      case 'tool-call':
        parts.push(`[tool call: ${block.name}] ${block.arguments}`)
        break
      case 'tool-result':
        parts.push(`[tool result${block.isError === true ? ': error' : ''}] ${contentText(block.content)}`)
        break
      case 'image':
        parts.push('[image attachment]')
        break
      case 'reasoning':
        // Private reasoning is deliberately absent from the Clippy projection.
        break
      default:
        // ContentBlockMap is plugin-extensible. Unknown blocks carry no safe,
        // stable text contract for this observer.
        break
    }
  }
  return parts.join('\n')
}

export function messageEvidence(message: Message): ClippyEvidenceMessage | undefined {
  const text = truncate(contentText(message.content), MAX_MESSAGE_CHARS)
  return text === '' ? undefined : { role: message.role, text }
}

function recentMessageEvidence(messages: readonly Message[]): {
  messages: ClippyEvidenceMessage[]
  omitted: boolean
} {
  const selected: ClippyEvidenceMessage[] = []
  let chars = 0
  let omitted = false
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const source = messages[index]
    if (source === undefined) continue
    const projected = messageEvidence(source)
    if (projected === undefined) continue
    if (selected.length >= MAX_MESSAGES || chars + projected.text.length > MAX_CONTEXT_CHARS) {
      omitted = true
      break
    }
    selected.unshift(projected)
    chars += projected.text.length
  }
  return { messages: selected, omitted }
}

function eventText(blocks: readonly ContentBlock[]): string {
  return truncate(contentText(blocks), MAX_TOOL_RESULT_CHARS)
}

function recentToolEvidence(events: readonly SessionEvent[]): ClippyToolEvidence[] {
  const tools: Array<ClippyToolEvidence & { callId: string }> = []
  const byCall = new Map<string, number>()
  for (const event of events.slice(-MAX_EVENT_SCAN)) {
    if (event.type === 'tool/call') {
      const tool = {
        callId: String(event.data.callId),
        name: event.data.name,
        arguments: truncate(event.data.arguments, MAX_TOOL_ARGUMENT_CHARS),
        outcome: 'running' as const,
      }
      byCall.set(tool.callId, tools.length)
      tools.push(tool)
      continue
    }
    if (event.type !== 'tool/result') continue
    const callId = String(event.data.message.source.callId)
    const index = byCall.get(callId)
    if (index === undefined) continue
    const previous = tools[index]
    if (previous === undefined) continue
    const excerpt = eventText(event.data.message.content)
    tools[index] = {
      ...previous,
      outcome: event.data.error === undefined ? 'success' : 'error',
      ...(excerpt === '' ? {} : { resultExcerpt: excerpt }),
    }
  }
  return tools.slice(-MAX_TOOLS).map(({ callId: _callId, ...tool }) => tool)
}

function recentErrors(events: readonly SessionEvent[]): string[] {
  const errors: string[] = []
  for (const event of events.slice(-MAX_EVENT_SCAN)) {
    if (event.type === 'tool/result' && event.data.error !== undefined) {
      errors.push(truncate(
        `${event.data.error.name}${event.data.error.code === '' ? '' : ` (${event.data.error.code})`}: ${eventText(event.data.message.content)}`,
        MAX_ERROR_CHARS,
      ))
    } else if (event.type === 'turn/end' && event.data.reason.kind === 'error') {
      errors.push(truncate(
        `${event.data.reason.error.code}: ${event.data.reason.error.message}`,
        MAX_ERROR_CHARS,
      ))
    }
  }
  return errors.filter(Boolean).slice(-MAX_ERRORS)
}

export function continuousActivityMinutes(events: readonly SessionEvent[], now = Date.now()): number {
  const last = events.at(-1)
  if (last === undefined) return 0
  let start = last.time
  for (let index = events.length - 2; index >= 0; index -= 1) {
    const event = events[index]
    const next = events[index + 1]
    if (event === undefined || next === undefined || next.time - event.time > ACTIVITY_GAP_MS) break
    start = event.time
  }
  return Math.max(0, Math.round((now - start) / 60_000))
}

/**
 * Project the full session into one bounded evidence object. Semantic history
 * comes from deriveMessages() so compaction/replacement is respected; the raw
 * log contributes only operational facts that derived history intentionally omits.
 */
export function buildClippyEvidence(agent: Agent, now = Date.now()): ClippyEvidence {
  const derived = agent.session.deriveMessages()
  const selected = recentMessageEvidence(derived)
  const events = agent.session.events
  return {
    ...(agent.session.header.cwd === undefined ? {} : { cwd: agent.session.header.cwd }),
    activityMinutes: continuousActivityMinutes(events, now),
    recentMessages: selected.messages,
    recentTools: recentToolEvidence(events),
    recentErrors: recentErrors(events),
    omittedEarlierContext: selected.omitted,
  }
}
