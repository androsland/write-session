# TODOS

## Verification gaps

- **Concurrency is implemented but not yet exercised under real contention** (build,
  2026-08-08). The per-session turn files, the atomic-`mkdir` mutex and the
  temp-file+rename write are all in `hooks/session-md.mjs`, and single-session behaviour
  is tested, but two live Claude Code sessions racing on one repo has not been run.
  Needs a harness that fires N concurrent hook processes against one state dir and
  asserts the narrative region survives every interleaving.
- **`last_assistant_message` verified only on Claude Code 2.1.224** (build, 2026-08-08).
  The `transcript_path` fallback was written against the jsonl shape observed on that
  build (`{type:"assistant", message:{content:[{type:"text",…}]}}`) and is not a
  documented public contract. No minimum-version floor is declared in `plugin.json`
  because no version field was confirmed to be enforced — check whether one exists.
- **Node is assumed present on `PATH`** (build, 2026-08-08). Claude Code now ships as a
  native binary, so a user who installed it that way and has no Node will get a failing
  hook every turn. Documented as a requirement; no graceful degradation exists. Consider
  whether a hook that cannot spawn surfaces a per-turn error to the user, and if so
  whether that is tolerable.

## Design decisions to revisit

- **Caps are tuned to one user's profile** (build, 2026-08-08): 6 turns × 400 chars was
  chosen against Opus sessions running ~240k median context. A smaller model with 40k
  sessions probably wants different numbers. They are env-configurable, but the defaults
  have no evidence behind them beyond one person's usage.
- **State dir renamed `~/.claude/session-md` → `~/.claude/write-session`** (build,
  2026-08-08). Anyone migrating from the hand-rolled hook will leave the old directory
  behind. Harmless (6 turns of scratch) but undocumented cleanup.

## Distribution

- **Not published.** `plugin.json` and `marketplace.json` name
  `github.com/androsland/write-session`, which does not exist yet. Either create it or
  correct both files before anyone tries the marketplace install path in the README.

## Completed

- Split-checkpoint hook + `/write-session` command built and verified single-session
  (2026-08-07), packaged as a plugin (2026-08-08).
