/** Dsh host half: context analysis, model call, manual command, and quiet timer route. */
import type { Context } from '@deepseek-ai/cordis'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import { generateClippyResponse } from './generator.ts'
import { CLIPPY_GENERATE_PATH, makeClippyGenerateHandler } from './http.ts'

export const name = 'ui-clippy'
export const inject = ['commands', 'llm', 'agents', 'webServer']

export interface Config {
  /** Optional Dsh provider route used only for Clippy generation. */
  readonly provider?: string
  /** Optional model id used only for Clippy generation, including an OpenRouter preset id. */
  readonly model?: string
  /** Optional reasoning effort used only for Clippy generation. */
  readonly reasoningEffort?: string
}

export const Config: z<Config> = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
})

export function apply(ctx: Context, config: Config = {}): void {
  const routeOverride = {
    ...(config.provider === undefined ? {} : { provider: config.provider }),
    ...(config.model === undefined ? {} : { model: config.model }),
    ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(config.reasoningEffort) }),
  }
  ctx.commands.register({
    name: 'clippy',
    description: 'Ask Clippy what it looks like you are doing',
    handler: async ({ agent, signal }) => ({
      kind: 'success',
      text: await generateClippyResponse(ctx, agent, signal, Math.random, routeOverride),
    }),
  })
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CLIPPY_GENERATE_PATH,
    handler: makeClippyGenerateHandler(ctx, routeOverride),
  }), 'clippy: generation route')
}
