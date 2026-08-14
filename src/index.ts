/** Dsh host half: context analysis, model call, manual command, and quiet timer route. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import { generateClippyResponse } from './generator.ts'
import { CLIPPY_GENERATE_PATH, makeClippyGenerateHandler } from './http.ts'

export const name = 'ui-clippy'
export const inject = ['commands', 'llm', 'agents', 'webServer']

export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'clippy',
    description: 'Ask Clippy what it looks like you are doing',
    handler: async ({ agent, signal }) => ({
      kind: 'success',
      text: await generateClippyResponse(ctx, agent, signal),
    }),
  })
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CLIPPY_GENERATE_PATH,
    handler: makeClippyGenerateHandler(ctx),
  }), 'clippy: generation route')
}
