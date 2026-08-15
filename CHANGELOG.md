# Changelog

## 0.1.10 - 2026-08-15

- Run the automatic commentary timer while Dsh is working as well as idle, without aborting generation when the agent changes state.
- Remember the last successfully summarized session evidence and skip later timer ticks until visible conversation, tool, error, queue, or run-state evidence changes.
- Ignore blank sessions, private reasoning updates, and Clippy's own command lifecycle when deciding whether commentary has new material.
- Smoothly exit the current animation before speech, hold the avatar still under the balloon, then resume the latest projected activity or idle motion.

## 0.1.9 - 2026-08-15

- Exit activity animations promptly when Dsh changes state or returns to idle, while retaining only the newest pending state and a bounded smooth-exit grace period.
- Keep idle animation running while `/clippy` generates and restart it reliably after the first snapshot, session changes, startup focus races, activity, speech, and flourishes.
- Replace the conspicuous two-animation idle handoff with one subdued eyebrow motion; keep finger tapping, head scratching, and side-to-side motion in the rare flourish pool.
- Hold a completed balloon for five seconds after its last word appears rather than timing from the beginning of speech.
- Make tab pause/resume edge-triggered so paired visibility and focus events cannot create duplicate animator loops.

## 0.1.8 - 2026-08-15

- Make startup and post-speech idle unmistakable with an immediate eyebrow motion followed directly by the longer side-to-side idle.
- Document that Clippy intentionally holds his pose while a generated speech balloon is visible.

## 0.1.7 - 2026-08-15

- Replace clippy.js's untracked one-shot startup idle with a guaranteed visible, lifecycle-tracked quiet motion.
- Clear the idle-active latch when an idle action exits, restart quiet motion after activity or speech expires, and alternate ambient animations after 12–30 seconds.
- Keep larger idle flourishes sparse and defer them instead of interrupting an ambient animation already in progress.

## 0.1.6 - 2026-08-15

- Prefer rhetorical, evidence-safe apparent mistakes such as `you forgot to` when a failed expectation states both intended and actual behavior.
- Accept concise observations beginning with a specific `your` subject while keeping diagnoses and workflows second-person.
- Give both high-reasoning attempts a hard 90-second deadline even when a provider stream does not promptly unwind on abort.
- Retry failed high- or medium-reasoning drafts at low reasoning when the exact model route advertises it, preserving compatibility with models whose effort taxonomy differs.
- Allow Clippy to use a dedicated configured Dsh model route, including an OpenRouter preset that pins an upstream provider.
- Pin prompt evaluations to the official DeepSeek endpoint for current V4 Flash and Pro models and record the serving provider.
- Exit activity animations through their authored waiting/exit branches, then reliably restart authentic idle instead of freezing on an exited idle frame.
- Preserve an active speech instance across blur/focus without replaying its balloon or restarting its hold time.

## 0.1.5 - 2026-08-14

- Accept usable short drafts without exact evidence excerpts; tolerate fenced JSON and harmless legacy fields instead of needlessly falling back.
- Prefer the established mistake over a literal repair or passing-test summary, while retaining the diagnosis/observation/workflow confidence ladder.
- Give the primary high-reasoning attempt 2,048 tokens/60 seconds and the retry 2,048 tokens/120 seconds; log sanitized failure categories for degraded paths.
- Recognize commands nested inside generic `bash` arguments and extract test results from their output.
- Bypass clippy.js's non-cancellable active queue for state animations and balloons, fixing later `/clippy` messages that remained stuck behind an animation.
- Play one activity at a time, retain only the newest pending state, then return to authentic idle; preserve and replay speech across focus changes.

## 0.1.4 - 2026-08-14

- Preserve the live session's reasoning effort. Give a high-reasoning primary attempt 3,072 tokens/90 seconds and its simpler lower-tier retry 2,048 tokens/60 seconds.
- Hold generated speech balloons for at least 15 seconds instead of letting the completion animation dismiss them immediately.
- Play activity animations only on state changes instead of forcibly restarting long-running tool animations every five seconds.
- Add a non-repeating, quiet idle flourish at randomized 90-second to four-minute intervals.
- Prefer a fact-only latest test, file-update, or tool-status line before the generic final fallback, with named detection for common waitable operations.
- Keep model-validation internals out of browser and host console messages.

## 0.1.3 - 2026-08-14

- Raise the completion budget to 1,024 tokens so reasoning-capable routes have room to return the strict short draft.

## 0.1.2 - 2026-08-14

- Add a diagnosis, observation, and workflow confidence ladder.
- Require exact non-user support excerpts for diagnoses and observations, validated by the host before display.
- Prefer conservative fallback over unsupported causes and lower factual sampling temperature.
- Retry one rejected draft at a lower confidence tier, then use a deterministic generic workflow line.
- Choose Office offers randomly from the full taxonomy while avoiding recent repeats.

## 0.1.1 - 2026-08-14

- Replace literal activity summaries with short, evidence-grounded technical conclusions.
- Add reusable prompt-comparison traces covering debugging, UI, benchmarks, research, deployment, and packaging.

## 0.1.0 - 2026-08-14

- Add the authentic animated Clippy companion to the Dsh web client.
- Map live agent states to Thinking, Writing, Searching, GetAttention, Congratulate, and Alert animations.
- Add bounded, reasoning-free conversation analysis with earnest Office-era observations.
- Add `/clippy` and randomized idle triggers.
- Select among three model-recommended comic interpretations with a non-repeating full-taxonomy fallback.
- Document original Clippit artwork provenance and third-party rights.
