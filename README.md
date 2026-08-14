# Clippy for Dsh

The earnest Microsoft Office Assistant, watching your [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) session with alarming technical accuracy and offering completely misplaced Office help.

![Clippy offering to turn a distributed-systems debugging session into a memo](docs/clippy-live-demo.png)

Clippy animates with the agent state (`Thinking`, `Writing`, `Searching`, `GetAttention`, `Congratulate`, and `Alert`). Idle bubbles appear after a randomized 8–20 minute delay. Recent conversation, tool, error, and timing evidence is bounded; private reasoning is excluded.

## Install

Download `dsh-clippy-0.1.0.tgz` from the GitHub release, then use Dsh's supported profile installer:

```sh
dsh plugin --profile web add ./dsh-clippy-0.1.0.tgz
dsh --profile web
```

Restart an already-running profile after installation. Remove Clippy with:

```sh
dsh plugin --profile web remove dsh-clippy
```

To install a source checkout for development instead:

```sh
dsh plugin --profile web add link:/absolute/path/to/clippy
```

## Use

Clippy moves automatically with the current session. Trigger an immediate observation for testing:

```text
/clippy
```

The model proposes three tangential-but-plausible Office interpretations. Clippy chooses among them; a recently repeated recommendation triggers a random non-repeating choice from the entire Office taxonomy.

## Develop

Requires Node.js 22.19+ and pnpm.

```sh
corepack pnpm install
corepack pnpm test
corepack pnpm build
corepack pnpm pack:check
```

## Credits

Built with [`clippyjs`](https://github.com/pithings/clippy), descended from the original [`clippy.js`](https://github.com/clippyjs/clippy.js) browser port. Those projects provide the extracted Clippit animation table and sprite atlas. Microsoft retains the character artwork, animations, sounds, names, and brand; see [artwork provenance](docs/art-provenance.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

This plugin's source is MIT licensed.
