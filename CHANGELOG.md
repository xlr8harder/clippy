# Changelog

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
