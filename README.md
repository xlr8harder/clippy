# Clippy for Dsh

The earnest Microsoft Office Assistant, watching your [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) session with alarming technical accuracy and offering completely misplaced Office help.

![Clippy turning a distributed-systems diagnosis into a meeting agenda](docs/clippy-live-demo.png)

Clippy animates when the agent state changes (`Thinking`, `Writing`, `Searching`, `GetAttention`, `Congratulate`, and `Alert`), then rests. He deliberately holds still while a generated balloon is visible. While resting, a small eyebrow motion recurs after 12–30 seconds and a larger idle flourish appears every 90 seconds to four minutes; idle bubbles appear after 8–20 minutes. Recent conversation, tool, error, and timing evidence is bounded; private reasoning is excluded.

## Install

Download `dsh-clippy-0.1.9.tgz` from the GitHub release, then use Dsh's supported profile installer:

```sh
dsh plugin --profile web add ./dsh-clippy-0.1.9.tgz
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

Clippy moves automatically with the current session. Generated balloons remain visible for five seconds after the full text appears. Trigger an immediate conclusion for testing:

```text
/clippy
```

Clippy uses the strongest available conclusion: brief diagnosis, salient observation, or short workflow fallback. A usable short draft is displayed without an exact-quotation ceremony; malformed, exhausted, or timed-out output gets one observation/workflow retry. When the exact model route advertises a `low` reasoning effort, Clippy uses it for that retry; other models keep their original effort. After that Clippy reports the latest structured test, file, or tool fact before resorting to a generic line. Office offers are uniformly random and do not repeat among the four most recent offers.

Clippy normally follows the session model. To use a dedicated Dsh model route—such as an OpenRouter preset that pins an upstream provider—override the installed plugin in `$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- id: ui-clippy
  config:
    provider: openrouter
    model: '@preset/dsh-clippy-v4-flash-official'
    reasoningEffort: high
```

The provider and model must already be configured in Dsh. See [OpenRouter presets](https://openrouter.ai/docs/guides/features/presets) for provider-specific routing.

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
