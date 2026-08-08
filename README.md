<h1 align="center">write-session</h1>

<p align="center">
  <b>Survive <code>/clear</code> in Claude Code without paying to re-read the conversation you just cleared.</b>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Claude Code plugin" src="https://img.shields.io/badge/Claude%20Code-plugin-d97757">
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.1-informational">
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

## What it writes to disk — read this first

`SESSION.md` contains **excerpts of your conversation**: the last few assistant messages,
truncated to 400 characters each, plus your branch name, commit subjects and the paths of
your dirty files. By default it is written **into your repo root**.

- It is kept out of commits via `.git/info/exclude`, verified with `git check-ignore` on
  every turn. Two entries are written, `/SESSION.md` and `/SESSION.md.tmp-*` — the second
  covers the temp file a killed process can leave behind, which holds the same content and
  which the exact-name pattern would not match. If verification fails — most often because
  the repo already tracks a `SESSION.md` — the hook writes a **visible warning into the file
  itself** rather than failing silently. A `git add -f SESSION.md` still overrides the
  exclude; nothing can stop that.
- Assistant text **and git metadata** are scrubbed for high-confidence secret shapes
  (private keys, `sk-`/`sk_live_`/`ghp_`/`npm_`/`pypi-`/`xox`-style tokens, AWS/Google keys,
  JWTs, `Bearer`/`Basic` headers, `PASSWORD=`/`TOKEN=`/`CONNECTION_STRING=` assignments,
  credentials in URLs). Git metadata goes through the same scrubber because it lands in the
  file with no one typing anything — a branch named after a token, or a commit subject that
  quotes one, is the more automatic of the two paths. **This is best effort, not a
  guarantee** — it cannot recognise a secret that looks like ordinary prose. Set
  `WRITE_SESSION_REDACT=0` to turn it off, never treat its output as safe to publish.
- The hook runs `git status`, `git log`, `git diff --shortstat`, `git rev-parse` and
  `git check-ignore` at the end of **every turn**, in whatever repo you have open. Cheap and
  read-only, but it is process execution you did not have before.
- The repo root and `cwd` are written into the file verbatim, and on most machines those
  paths embed your OS username (`/home/you/…`, `C:\Users\You\…`). If you paste `SESSION.md`
  anywhere, that goes with it.
- Turn history lives under `~/.claude/write-session/`, pruned after 7 days. With
  `WRITE_SESSION_LOCATION=home` the `SESSION.md` itself also lives there, and is retired by
  the same 7-day sweep once no live turn file sits beside it.
- A temp file orphaned by a killed process (`SESSION.md.tmp-<pid>`, holding the same content
  as `SESSION.md`) is swept after an hour **in both locations** — the state directory and,
  in the default configuration, your repo root. Only names this hook itself writes are
  matched, so a file of yours that merely contains `.tmp-` is never touched.
- **The default repo-root `SESSION.md` has no automatic expiry.** The 7-day sweep above
  applies to the state directory, not to your repo — the file in your repo is rewritten
  every turn and persists until you delete it or uninstall. Retention is bounded on the
  state-directory path and unbounded, by design, on the default one.

If any of that is unwanted: `WRITE_SESSION_LOCATION=home` keeps `SESSION.md` out of the repo
entirely, and `WRITE_SESSION=0` disables the plugin.

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
| `WRITE_SESSION_GIT_EXCLUDE=0` | on | Do not touch `.git/info/exclude` (the ignore check still runs) |
| `WRITE_SESSION_REDACT=0` | on | Disable best-effort secret scrubbing — of turn text **and** of git metadata (branch, commit subjects, dirty paths) |
| `WRITE_SESSION_MAX_TURNS` | `6` | Ring buffer depth (1–50) |
| `WRITE_SESSION_MAX_TURN_CHARS` | `400` | Per-turn truncation (80–4000) |
| `WRITE_SESSION_MAX_DIRTY` | `15` | Dirty files listed before eliding (1–200) |
| `WRITE_SESSION_STATE_DIR` | `~/.claude/write-session` | Override the state root |

Inside a git repo, `SESSION.md` is added to `.git/info/exclude` — local-only, never appears
in a diff, never touches your tracked `.gitignore`. The path is resolved with
`git rev-parse --git-path`, so it lands in the **common** git dir and works from inside a
linked worktree, where `.git/worktrees/<name>/info/exclude` would be silently ignored by git.
The result is then verified with `git check-ignore`; if the file is still not ignored, the
hook says so in the file rather than assuming it worked.

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
  modification. The `check-ignore` verification detects exactly this case and puts a warning
  banner in the file, but it cannot resolve it for you: set `WRITE_SESSION_LOCATION=home` or
  `WRITE_SESSION=0`.
- **Secret scrubbing is pattern-matching, and pattern-matching has a floor.** It catches
  recognisable credential shapes. It cannot catch a password that looks like a word, an
  internal hostname, a customer name, or anything whose sensitivity comes from context
  rather than form. On a repo where the conversation itself is confidential, keep
  `SESSION.md` out of the tree with `WRITE_SESSION_LOCATION=home`.
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

## Untrusted input

`SESSION.md` is designed to be read back into a fresh agent session, which makes everything
in it agent input. Commit subjects, branch names and file paths come from whoever wrote the
repo — not from you — so every git-derived string is markdown-neutralised (`<`, `>` and
backticks are replaced) and length-capped before interpolation. Region markers are matched
line-anchored and the splice takes the **last** `auto:end`, so a forged marker cannot move
the boundary and strand a fabricated "Next steps" section in your narrative. Clone a hostile
repo and the worst it gets is odd-looking text inside a code span.

## Tests

```bash
node test/run.mjs
```

207 assertions, no framework and no dependencies. `core.test.mjs` (49) covers normal
operation, caps, concurrency, kill switches, markerless adoption and manifest validity;
`hardening.test.mjs` (158) is regression coverage for the worktree-exclude and
marker-forgery bugs fixed in 0.1.1, plus redaction of both turn text and git metadata, the
tracked-file warning, TTL and temp-file sweeping, symlink guards, and timing assertions that
every redaction pattern stays linear on a 64 KB adversarial corpus. Each suite builds
throwaway git repos under the system temp dir and removes them when it finishes.

The secret-redaction tests are worth a note, because three earlier versions of them claimed
coverage they did not have, and each failure was silent:

- The ReDoS corpus timed **one** occurrence of each token prefix — the one shape that
  *cannot* trigger a restart-per-boundary blowup. It reported 18 ms while two patterns were
  quadratic. It now repeats every prefix against eight separators.
- The regex that scraped patterns out of the source required a `[` immediately before the
  literal, so a pattern written across several lines was never timed at all: 14 of 15, with
  nothing to indicate the fifteenth was missing. It is now line-anchored and cross-checks
  the count of extracted patterns against the count declared in the source.
- The length-sensitivity tests asserted only that the hook **finished quickly**, never that
  the secret was gone. That is how a fix which stopped redacting oversized tokens entirely
  passed a green suite. Every such case now asserts the secret is *absent* from the
  resulting `SESSION.md`, and each was confirmed to fail against the broken version.

A fourth: the linear-scaling assertion used to run only for patterns slower than 30 ms, so
when the patterns got fast enough it stopped running altogether and the assertion count just
dropped by one. It now always runs for the three slowest, and falls back to an absolute
bound when a pattern is too fast to time a meaningful ratio.

A fifth, and the one worth generalising from: after the JWT and assignment patterns were
fixed for exactly this defect, a *third* pattern with the same shape sat untested beside
them. The URL-credential tests used 9- and 18-character passwords, so they could not fail at
the length that mattered, and the pattern silently missed any credential past 256 characters.
Fixing a bug is not the same as sweeping for its siblings; the boundary is now asserted on
both sides — the longest length that redacts and the shape that provably does not.

Six assertions self-skip on Windows: a dirty path carrying a forged marker (Windows forbids
`<` and `>` in filenames — the commit-subject vector exercises the same sanitizer), and
five symlink cases (creating a symlink needs elevation). Run `node test/run.mjs` under WSL
or Linux for the full 207.

### Known limits, stated rather than implied

- **The git half goes quiet if you start the session outside the repo you are editing.** The
  anchor is the directory Claude Code was launched in, not wherever your edits land. Start it
  in `~` and work on a project elsewhere and every turn records `Not a git repository` — no
  branch, no HEAD, no dirty list, no recent commits — for the life of the session. Nothing in
  the file marks the absence, so it reads as a correct answer about the wrong directory. The
  hook is told where you started and what you last said; it is not told which files you
  touched, so it cannot detect the mismatch without parsing the transcript every turn, which
  is the cost this design exists to avoid. Launch Claude Code from inside the repo, or `cd`
  there, if you want the free half to do anything. The narrative half is unaffected.
- **A secret needs more than 256 characters between the keyword and the `=` to escape the
  assignment pattern** (`VERY_LONG_..._SECRET_..._NAME=value`). The bound exists because an
  unbounded span there is quadratic; 256 covers every realistic identifier, and the suite
  asserts this limit explicitly so it cannot be mistaken for full coverage.
- **On Windows, `writeAtomic`'s fallback cannot refuse a symlink at the syscall level.** It
  opens with `O_NOFOLLOW`, which does not exist on Windows and degrades to a plain create.
  Creating a symlink there requires elevation or developer mode; the primary rename path is
  safe on both platforms, and the fallback only runs when `rename` itself fails.
- **Redaction cannot see a secret that looks like prose** — an internal hostname, a customer
  name, a password that is a dictionary word. No pattern set fixes this; it is why the
  scrubber is documented as a seatbelt rather than a guarantee.
- **A repo-root temp file is swept on the next turn in that repo, not on a timer.** The hook
  only runs while you are working, so if a process is killed and you never open that repo
  again, the orphan stays — git-excluded, but present. Closing that would need a background
  process, which this deliberately is not.
- **The state-root sweep stops at anything it did not write.** That is the safety rule, and
  it is also a limit: a foreign file parked in a per-anchor state directory keeps that
  directory, and the `SESSION.md` in it, alive past the TTL. The hook's own leftovers are
  handled — a `.lock` orphaned by a killed process is reclaimed once it is itself 7 days old,
  which also releases the `SESSION.md` it was holding — but anything else is left where it is,
  on purpose. If you care about the retention window, don't store your own files under
  `~/.claude/write-session/`.
- **A killed session can delay one file's retirement by up to a further 7 days.** A `.lock` is
  stamped when its owner takes it and blocks retirement of the `SESSION.md` beside it until the
  lock is itself past the TTL — that is what stops a sweep deleting a file a slow-but-live run
  has not read yet. Normally both age together and it costs nothing. The exception is a session
  that died on its first turn after a long gap, leaving a fresh lock beside an already-old file.
  Unlike the limit above, nothing you do avoids this one; it is bounded, not open-ended.

## Uninstall

```bash
/plugin uninstall write-session@write-session
```

Then delete any leftover `SESSION.md` files and `~/.claude/write-session/`. The
`/SESSION.md` line the hook appended to `.git/info/exclude` is local-only and harmless, but
you can remove it by hand if you want.

## License

MIT © androsland
