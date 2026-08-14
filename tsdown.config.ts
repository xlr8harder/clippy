import { clientBundle } from './build/tsdown.client.ts'

export default clientBundle('dsh-clippy', [
  'src/index.ts',
], {
  libExternal: [
    '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-commands',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-session',
  ],
})
