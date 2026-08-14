# Clippit artwork provenance

## What the plugin loads

At runtime, `clippyjs@0.1.0` supplies:

- `dist/agents/clippy/map.mjs` — the extracted PNG sprite atlas encoded as a data URL
- `dist/agents/clippy/agent.mjs` — animation frames, branches, and durations

The upstream lineage is:

1. `clippyjs/clippy.js`, the original browser port
2. `pithings/clippy` (published as `clippyjs`), the maintained TypeScript/browser package used here

The original Clippy.js atlas and the PNG decoded from the installed
`clippyjs@0.1.0` data URL are byte-identical. Their SHA-256 is:

```text
880b63ac4d3fa84c78eceb02674c9eaedae032b2d85887539a7f6d107e5801e9  agents/Clippy/map.png
```

## Original Microsoft files located

The character's Microsoft name/file stem is **Clippit**, even though the common product nickname is Clippy.

- Office 97 actor: `CLIPPIT.ACT` (468,266 bytes)
- Microsoft Agent / later Office Assistant character: `CLIPPIT.ACS` (2,904,417 bytes)

Public archival copies were located at:

- <https://tmafe.com/classic-ms-actors/clippit.act>
- <https://tmafe.com/classic-ms-agents/CLIPPIT.ACS>
- <https://agentpedia.tmafe.com/wiki/Clippy>

Microsoft's ACS format combines the character definition and animation data in one binary. Office documentation and archived Knowledge Base material identify `Clippit.act`/`Clippit.acs` as the installed assistant files.

Local format-research copies now live in `research/originals/` and are ignored intentionally. Their exact sizes and SHA-256 values are recorded in that directory's tracked README.

## Rights boundary

The plugin's own source is MIT licensed. The JavaScript/CSS portions of the Clippy.js lineage are MIT licensed. The Microsoft Agent character artwork, animations, names, sounds, and Clippy brand remain Microsoft property according to both Clippy.js projects. This repository therefore records provenance and uses the published dependency but does not vendor the original Microsoft binaries.
