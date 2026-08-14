import { describe, expect, it } from 'vitest'
import type { ClippyEvidence } from './context.ts'
import { operationalFallbackStatement } from './fallback.ts'

function evidence(tool: ClippyEvidence['recentTools'][number]): ClippyEvidence {
  return {
    activityMinutes: 1,
    recentMessages: [],
    recentTools: [tool],
    recentErrors: [],
    omittedEarlierContext: false,
  }
}

describe('operational fallback', () => {
  it('reports exact test counts without diagnosing their cause', () => {
    expect(operationalFallbackStatement(evidence({
      name: 'run_tests',
      arguments: '--repeat 100',
      outcome: 'success',
      resultExcerpt: '99 passed; one assertion observed 4 results instead of 5',
    }))).toBe('your latest test run reported 99 passed')
  })

  it('reports a successful file update when the path is structured', () => {
    expect(operationalFallbackStatement(evidence({
      name: 'apply_patch',
      arguments: '*** Update File: src/file.py',
      outcome: 'success',
    }))).toBe('you updated file.py')
  })

  it('reports the newest failed or running operation conservatively', () => {
    expect(operationalFallbackStatement(evidence({
      name: 'test--foo', arguments: '', outcome: 'error',
    }))).toBe('your latest test run failed')
    expect(operationalFallbackStatement(evidence({
      name: 'git_bisect', arguments: '', outcome: 'running',
    }))).toBe('your git bisect is still running')
  })

  it.each([
    ['{"cmd":"corepack pnpm test"}', 'test run'],
    ['{"cmd":"git push origin main"}', 'git push'],
    ['{"cmd":"git fetch --all"}', 'repository sync'],
    ['{"cmd":"corepack pnpm build"}', 'build'],
    ['{"cmd":"tsc --noEmit"}', 'type check'],
    ['{"cmd":"npm publish"}', 'publish'],
    ['{"cmd":"wrangler deploy"}', 'deployment'],
    ['{"cmd":"pip install -r requirements.txt"}', 'dependency install'],
    ['{"cmd":"hyperfine ./bench"}', 'benchmark'],
    ['{"cmd":"wget https://example.test/archive"}', 'download'],
    ['{"cmd":"rclone sync ./dist remote:dist"}', 'upload'],
  ])('recognizes a waitable shell operation: %s', (argumentsJson, label) => {
    expect(operationalFallbackStatement(evidence({
      name: 'exec_command', arguments: argumentsJson, outcome: 'running',
    }))).toBe(`your ${label} is still running`)
  })

  it('finds the actual command inside generic bash and nested tool arguments', () => {
    expect(operationalFallbackStatement(evidence({
      name: 'bash',
      arguments: '{"input":{"command":"corepack pnpm test"}}',
      outcome: 'success',
      resultExcerpt: 'Test Files 8 passed (8)\nTests 44 passed (44)',
    }))).toBe('your latest test run reported 44 passed')
    expect(operationalFallbackStatement(evidence({
      name: 'bash',
      arguments: '{"request":{"argv":["git","push","origin","main"]}}',
      outcome: 'success',
    }))).toBe('your latest git push completed successfully')
  })

  it('sanitizes unrecognized tool names before display', () => {
    expect(operationalFallbackStatement(evidence({
      name: '<script>alert(1)</script> deploy_prod', arguments: '', outcome: 'success',
    }))).toBe('your latest scriptalert1script deploy prod completed successfully')
  })
})
