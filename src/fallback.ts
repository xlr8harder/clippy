import type { ClippyEvidence, ClippyToolEvidence } from './context.ts'

const TEST_NAME = /(?:^|[_-])(test|tests|pytest|vitest|jest)(?:$|[_-])/iu
const FILE_WRITE_NAME = /(apply|create|edit|patch|update|write)/iu

const SHELL_TOOL = /(?:^|[_-])(bash|command|exec|shell|terminal)(?:$|[_-])/iu

const WAITABLE_OPERATIONS = [
  { label: 'test run', pattern: /\b(?:cargo\s+test|go\s+test|pytest|vitest|jest|pnpm\s+(?:run\s+)?test|npm\s+(?:run\s+)?test|yarn\s+(?:run\s+)?test|bun\s+(?:run\s+)?test)\b/iu },
  { label: 'git push', pattern: /\bgit\s+push\b/iu },
  { label: 'repository sync', pattern: /\bgit\s+(?:fetch|pull)\b/iu },
  { label: 'deployment', pattern: /\b(?:deploy|wrangler\s+deploy|vercel\s+deploy)\b/iu },
  { label: 'publish', pattern: /\b(?:npm|pnpm|yarn)\s+publish\b|\bgh\s+release\s+create\b/iu },
  { label: 'build', pattern: /\b(?:cargo\s+build|go\s+build|pnpm\s+(?:run\s+)?build|npm\s+(?:run\s+)?build|yarn\s+(?:run\s+)?build|bun\s+(?:run\s+)?build|make(?:\s|$))\b/iu },
  { label: 'type check', pattern: /\b(?:typecheck|type-check|tsc)(?:\s|$)/iu },
  { label: 'lint check', pattern: /\b(?:eslint|ruff|golangci-lint|pnpm\s+(?:run\s+)?lint|npm\s+(?:run\s+)?lint|yarn\s+(?:run\s+)?lint)\b/iu },
  { label: 'dependency install', pattern: /\b(?:pnpm|npm|yarn|bun|pip|pipx)\s+(?:install|add)\b|\bcargo\s+install\b/iu },
  { label: 'package build', pattern: /\b(?:npm|pnpm|yarn)\s+pack\b/iu },
  { label: 'benchmark', pattern: /\b(?:benchmark|bench|hyperfine)\b/iu },
  { label: 'download', pattern: /\b(?:curl|wget|aria2c|huggingface-cli\s+download|hf\s+download)\b/iu },
  { label: 'upload', pattern: /\b(?:upload|rsync|rclone\s+(?:copy|sync)|aws\s+s3\s+cp)\b/iu },
] as const

function shellCommand(tool: ClippyToolEvidence): string | undefined {
  if (!SHELL_TOOL.test(tool.name) && !/["'](?:cmd|command)["']\s*:/iu.test(tool.arguments)) return undefined
  try {
    const parsed = JSON.parse(tool.arguments) as unknown
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>
      const command = record.cmd ?? record.command
      if (typeof command === 'string') return command
    }
  } catch {
    // Some Dsh tools expose the command as plain text rather than JSON.
  }
  return tool.arguments
}

function waitableLabel(tool: ClippyToolEvidence): string | undefined {
  const searchable = [tool.name, shellCommand(tool)].filter((value): value is string => value !== undefined).join(' ')
  return WAITABLE_OPERATIONS.find(operation => operation.pattern.test(searchable))?.label
}

function toolLabel(name: string): string {
  if (TEST_NAME.test(name) || /test/iu.test(name)) return 'test run'
  const cleaned = name
    .replace(/^(?:mcp__|tools?__)/iu, '')
    .replace(/[_-]+/gu, ' ')
    .replace(/[^\p{L}\p{N} .]+/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 36)
  return cleaned === '' ? 'tool' : cleaned
}

function updatedFilename(tool: ClippyToolEvidence): string | undefined {
  if (!FILE_WRITE_NAME.test(tool.name)) return undefined
  const candidate = tool.arguments.match(/(?:Update|Add) File:\s*([^\s*]+)/iu)?.[1]
    ?? tool.arguments.match(/(?:file_path|path)["']?\s*[:=]\s*["']([^"']+)/iu)?.[1]
    ?? tool.arguments.match(/(?:^|[\s"'=])((?:[\p{L}\p{N}_@.+-]+\/)*[\p{L}\p{N}_@.+-]+\.[\p{L}\p{N}]{1,12})(?=$|[\s"',:}\]])/iu)?.[1]
  if (candidate === undefined) return undefined
  const basename = candidate.replaceAll('\\', '/').split('/').at(-1)
    ?.replace(/[^\p{L}\p{N}_@.+-]/gu, '')
    .slice(0, 48)
  return basename === undefined || basename === '' ? undefined : basename
}

function testResult(tool: ClippyToolEvidence): string | undefined {
  if (!/test/iu.test(tool.name) || tool.resultExcerpt === undefined) return undefined
  const failed = tool.resultExcerpt.match(/\b(\d+)\s+(?:tests?\s+)?failed\b/iu)?.[1]
  if (failed !== undefined) return `your latest test run reported ${failed} failed`
  const passed = tool.resultExcerpt.match(/\b(\d+)\s+(?:tests?\s+)?passed\b/iu)?.[1]
  if (passed !== undefined) return `your latest test run reported ${passed} passed`
  return undefined
}

/** A model-free, fact-only line from the newest structured operational event. */
export function operationalFallbackStatement(evidence: ClippyEvidence): string | undefined {
  const latest = evidence.recentTools.at(-1)
  if (latest === undefined) return undefined

  const tests = testResult(latest)
  if (tests !== undefined) return tests

  const filename = latest.outcome === 'success' ? updatedFilename(latest) : undefined
  if (filename !== undefined) return `you updated ${filename}`

  const label = waitableLabel(latest) ?? toolLabel(latest.name)
  if (latest.outcome === 'error') return `your latest ${label} failed`
  if (latest.outcome === 'running') return `your ${label} is still running`
  return `your latest ${label} completed successfully`
}
