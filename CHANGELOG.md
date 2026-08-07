# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[SemVer](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-08-08

First release.

### Added

- **`Stop` hook** (`hooks/session-md.mjs`) that maintains the mechanical half of
  `SESSION.md` on every turn end at zero model tokens: branch, HEAD, dirty files,
  diffstat, recent commits, and a capped tail of recent turns. Writes nothing to
  stdout, always exits 0, never blocks a turn.
- **`/write-session` command** that fills the narrative half — decisions, dead ends,
  next steps, key files — in a single mandated tool batch.
- Marker-delimited regions (`session-md:auto:*` / `session-md:narrative:*`) so the hook
  and the model each own half of one file without touching the other's bytes.
- Pre-existing markerless `SESSION.md` files are adopted rather than clobbered.
- `SESSION.md` is added to `.git/info/exclude` inside a repo — local-only, invisible in
  diffs, and it never touches a tracked `.gitignore`.
- Concurrency safety for two Claude Code sessions in one repo: per-session turn files
  merged at read time, an atomic-`mkdir` mutex with stale-lock break around the
  read-splice-write, and temp-file + rename so readers never see a torn file. The lock
  fails open.
- Fallback to a bounded tail read of `transcript_path` when the harness does not supply
  `last_assistant_message`.
- Configuration by environment variable only — `WRITE_SESSION`,
  `WRITE_SESSION_LOCATION`, `WRITE_SESSION_GIT_EXCLUDE`, `WRITE_SESSION_MAX_TURNS`,
  `WRITE_SESSION_MAX_TURN_CHARS`, `WRITE_SESSION_MAX_DIRTY`, `WRITE_SESSION_STATE_DIR`.
  No config file, no first-run wizard, no prompts, no telemetry, no network calls.

### Notes

- Hooks are registered as `{"command": "node", "args": [...]}` rather than a bare shell
  string. With `args` present Claude Code spawns the executable directly with no shell;
  without it, `command` runs through bash on POSIX and PowerShell on Windows without Git
  Bash, which breaks the common `bash -c '…'` form.
- Requires Node 18+ on `PATH`. Zero npm dependencies.

[0.1.0]: https://github.com/androsland/write-session/releases/tag/v0.1.0
