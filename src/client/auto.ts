/** Stable browser-side evidence identity for automatic commentary cadence. */
import type {
  AssistantBlock,
  ConversationNode,
  ConversationSnapshot,
  RunningToolCall,
} from '@deepseek-ai/dsh-client-runtime/client'

function hashText(value: string): string {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return `${value.length}:${(hash >>> 0).toString(36)}`
}

function hashValue(value: unknown): string {
  try {
    return hashText(JSON.stringify(value) ?? '')
  } catch {
    return 'unserializable'
  }
}

function assistantBlocks(blocks: readonly AssistantBlock[]): readonly unknown[] {
  return blocks.flatMap((block): readonly unknown[] => {
    switch (block.kind) {
      case 'reasoning': return []
      case 'text': return [['text', hashText(block.text)]]
      case 'image': return [['image', hashValue(block.attachment)]]
      case 'tool-call': return [['tool-call', block.callId, block.name, hashText(block.argsRaw)]]
      case 'other': return [['other', hashValue(block.block)]]
      default: return []
    }
  })
}

function contentBlocks(blocks: readonly { readonly type: string }[]): readonly unknown[] {
  return blocks
    .filter(block => block.type !== 'reasoning')
    .map(block => [block.type, hashValue(block)])
}

function nodeStamp(node: ConversationNode): readonly unknown[] | undefined {
  if (node.kind === 'command' && node.name === 'clippy') return undefined
  switch (node.kind) {
    case 'user':
    case 'steering':
    case 'context':
      return [node.kind, node.seq, node.time, contentBlocks(node.content)]
    case 'assistant':
      return [node.kind, node.seq, node.time, node.turn, node.step, assistantBlocks(node.blocks), node.interrupted === true]
    case 'tool-result':
      return [
        node.kind,
        node.seq,
        node.time,
        node.callId,
        node.call?.name,
        node.call === null ? null : hashText(node.call.argsRaw),
        node.isError,
        contentBlocks(node.content),
        node.error?.code,
      ]
    case 'command':
      return [node.kind, node.seq, node.time, node.name, node.args, node.outcome]
    case 'model-retry':
      return [node.kind, node.seq, node.time, node.retryState, hashValue(node)]
    case 'turn-error':
      return [node.kind, node.seq, node.time, node.turn, node.step, node.code, hashText(node.message)]
    case 'turn-max-tokens':
      return [node.kind, node.seq, node.time, node.turn, node.step]
    case 'compaction':
      return [node.kind, node.seq, node.time, node.summaryEventSeq, node.shadowedItemCount, node.shadowedTokenCount]
    case 'unknown':
      return [node.kind, node.seq, node.time, node.type, hashValue(node.data)]
    default:
      return undefined
  }
}

function runningCallStamp(call: RunningToolCall): readonly unknown[] {
  return [
    call.callId,
    call.name,
    hashText(call.argsRaw),
    call.turn,
    call.step,
    call.time,
    call.subCalls.map(subCall => {
      if ('kind' in subCall) return ['result', subCall.callId, subCall.seq, subCall.isError]
      return runningCallStamp(subCall)
    }),
  ]
}

/**
 * Identify model-visible session progress without retaining transcript text.
 * Private reasoning and Clippy's own command lifecycle deliberately do not
 * re-arm automatic commentary.
 */
export function automaticActivityStamp(snapshot: ConversationSnapshot): string {
  return JSON.stringify({
    nodes: snapshot.nodes.flatMap(node => {
      const stamp = nodeStamp(node)
      return stamp === undefined ? [] : [stamp]
    }),
    partial: snapshot.partial === null
      ? null
      : [snapshot.partial.turn, snapshot.partial.step, assistantBlocks(snapshot.partial.blocks)],
    runningCalls: snapshot.runningCalls.map(runningCallStamp),
    pending: snapshot.pending.map(wait => [wait.kind, wait.key]),
    queue: snapshot.queue.map(message => [message.messageId, message.placement]),
    running: snapshot.running,
    lastAgentError: snapshot.lastAgentError === null ? null : hashText(snapshot.lastAgentError),
  })
}
