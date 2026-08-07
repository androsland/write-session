<h1 align="center">write-session</h1>

<p align="center">
  <b>Survive <code>/clear</code> in Claude Code without paying to re-read the conversation you just cleared.</b>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Claude Code plugin" src="https://img.shields.io/badge/Claude%20Code-plugin-d97757">
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.0-informational">
  <img alt="Zero dependencies" src="https://img.shields.io/badge/dependencies-0-brightgreen">
</p>

---

## The problem

Long Claude Code sessions get expensive, so you `/clear` — and lose everything. The usual
fix is a "save my context" command that reads the whole conversation and writes a summary.
That works, but it is the single most expensive thing you can run at the moment you are
already deepest in context, and most implementations run it as four or five sequential
steps. **In a deep session every tool round trip is a full request that re-reads the entire
conversation prefix.** A four-step save costs roughly four times a one-step save for the
same output.

Most of what those commands write, you already have for free.

## The idea

Split the checkpoint in two, and give the halves different owners.

| Half | Contents | Owner | Cost |
|---|---|---|---|
| **Mechanical** | branch, HEAD, dirty files, diffstat, recent commits, truncated tail of recent turns | `Stop` hook, every turn end | **zero model tokens** |
| **Narrative** | decisions, dead ends, next steps, key files | `/write-session`, run once | **one model request** |

Git already knows the mechanical half — asking a language model to restate it is paying
for a `git status`. So only the narrative half touches the model, only once, at the
boundary where you were going to `/clear` anyway.

## Quick start

```bash
/plugin marketplace add androsland/write-session
/plugin install write-session@write-session
```

Restart Claude Code — hooks register at startup. That is the whole setup; the mechanical
half maintains itself from that moment on.

Then, at the point where you would otherwise clear and lose everything:

```
/write-session
/clear
read SESSION.md and continue
```

## What you get

`SESSION.md` at your repo root (or under `~/.claude/write-session/` outside a repo):

```markdown
# SESSION — my-project

<!-- session-md:auto:start -->
**Updated** 2026-08-08 01:12 · **cwd** `/home/you/my-project` · **session** `a1b2c3d4`

## Git
- **Branch** `feat/payments...origin/feat/payments [ahead 3]`
- **HEAD** `9f2c1ab` wire Stripe webhook signature check
- **Dirty** 2 file(s) — 2 files changed, 61 insertions(+), 8 deletions(-)
  - ` M src/webhooks/stripe.ts`
  - `?? src/webhooks/stripe.test.ts`
- **Recent commits**
  - `9f2c1ab` wire Stripe webhook signature check
  - `4d81e77` add idempotency key to charge creation

## Recent turns (last 6, oldest first, truncated)
- **2026-08-08 00:54** Switched the webhook handler to verify the raw body before…
- **2026-08-08 01:12** Added the replay test; it fails because the fixture reuses…
<!-- session-md:auto:end -->

<!-- session-md:narrative:start -->
## Where we are
Signature verification works. The replay-protection test is red because…

## Dead ends (do not retry)
- Parsing the body before verifying — Stripe signs the raw bytes, so any
  middleware that JSON-parses first breaks the HMAC.

## Next steps
1. Give each fixture its own idempotency key.
<!-- session-md:narrative:end -->
```

The hook rewrites everything between the `auto` markers on every turn end and never
touches a byte outside them. Your narrative is safe.

## Why everything is capped

`SESSION.md` is read into the **prefix** of your fresh session, where it is re-read on
every subsequent request for the rest of that session. An append-every-turn log would make
the *save* free and the *restore* expensive — a cost inversion that gets worse the longer
the new session runs.

So: 6 turns, 400 characters each, 15 dirty files. **The caps are the feature.** Raising
them moves cost from somewhere you notice to somewhere you don't.

## What this costs

| | tokens |
|---|---|
| Always in context (one description line) | ~20 |
| Injected when you run `/write-session` | ~674 |
| Model round trips it induces | **1** |
| `session-md.mjs`, `hooks.json`, `plugin.json`, this README | **0, ever** |

The hook is the largest file in the repo and costs nothing, permanently — the harness
executes it, the model never reads it. It writes nothing to stdout, so it cannot inject
tokens into your conversation even indirectly.

There is deliberately **no `SessionStart` hook that auto-loads `SESSION.md`.** That would
push the file into the prefix of every session, paid for on every request whether you
wanted the restore or not. Restore stays manual, so you pay once, when you mean to.

For the same reason there is no config wizard, no first-run prompt, no telemetry, and no
network call. Each one of those is a round trip.

## Configuration

Environment variables only.

| Variable | Default | Effect |
|---|---|---|
| `WRITE_SESSION=0` | — | Disable entirely (`CLAUDE_SESSION_MD=0` also honored) |
| `WRITE_SESSION_LOCATION=home` | `repo` | Never write inside the repo; keep `SESSION.md` under the state dir |
| `WRITE_SESSION_GIT_EXCLUDE=0` | on | Do not touch `.git/info/exclude` |
| `WRITE_SESSION_MAX_TURNS` | `6` | Ring buffer depth (1–50) |
| `WRITE_SESSION_MAX_TURN_CHARS` | `400` | Per-turn truncation (80–4000) |
| `WRITE_SESSION_MAX_DIRTY` | `15` | Dirty files listed before eliding (1–200) |
| `WRITE_SESSION_STATE_DIR` | `~/.claude/write-session` | Override the state root |

Inside a git repo, `SESSION.md` is added to `.git/info/exclude` — local-only, never appears
in a diff, never touches your tracked `.gitignore`.

## Requirements

**Node 18+ on `PATH`.** The hook is registered as
`{"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/session-md.mjs"]}`. The `args`
form is deliberate: with `args` present Claude Code spawns the executable directly with no
shell, whereas a bare `command` string goes through bash on POSIX and **PowerShell on
Windows without Git Bash** — which is where the usual `bash -c '…'` form breaks. If you
installed Claude Code via the native binary and have no Node on `PATH`, this plugin will
not run.

Zero npm dependencies. Nothing is installed, nothing phones home.

## Built for

1. **A multi-day refactor on a feature branch.** Git supplies branch, diff and commits for
   free; what you lose across a `/clear` is *why* you chose this approach and which two you
   already rejected. That is exactly the narrative half.
2. **A working directory that is not a repo at all** — drafting docs, exploring an API,
   sysadmin work. No git state to report; the value is the turn tail plus the narrative,
   kept under `~/.claude/write-session/`.

## Non-goals and blind spots

Stated explicitly, because an unstated limit is indistinguishable from a claim of coverage.

- **It should not fire on a repo that tracks a shared `SESSION.md`.** The
  `.git/info/exclude` entry is inert for an already-tracked path, so the file stays tracked
  — and the hook rewrites its auto region every turn, showing up as a permanent uncommitted
  modification. If your team commits a `SESSION.md`, set `WRITE_SESSION_LOCATION=home` or
  `WRITE_SESSION=0`.
- **It cannot see whether a turn mattered.** There is no notion of importance: a throwaway
  "what's the weather" turn evicts a design decision from the 6-slot ring exactly as
  readily as anything else. The ring is recency, not relevance — which is precisely why the
  narrative half exists and is written by a model.
- **It sees only the final assistant text of each turn** — never tool calls, subagent
  output, or reasoning. Work that happened entirely inside tools leaves no trace beyond
  whatever git noticed.
- **`last_assistant_message` is verified present on Claude Code 2.1.224.** Older builds are
  untested; the hook falls back to a bounded tail read of `transcript_path`, which depends
  on a transcript format that is not a documented public contract.
- **Not a memory system.** It is scratch state for one `/clear` boundary. Anything that
  should outlive the session belongs in `TODOS.md` or your docs.

## Concurrency

Two Claude Code sessions in the same repo both run this hook. Turn history is stored one
file per session and merged at read time, so writers never contend on a shared ring buffer.
The read-splice-write of `SESSION.md` is guarded by an atomic-`mkdir` mutex with a
stale-lock break, and the file is written via temp-file + rename so a concurrent reader
never sees a torn file. The lock **fails open** — a lock that cannot be taken is not a
reason to skip the checkpoint.

The hook always exits 0 and swallows every error. It cannot block a turn.

## Uninstall

```bash
/plugin uninstall write-session@write-session
```

Then delete any leftover `SESSION.md` files and `~/.claude/write-session/`. The
`/SESSION.md` line the hook appended to `.git/info/exclude` is local-only and harmless, but
you can remove it by hand if you want.

## License

MIT © androsland
