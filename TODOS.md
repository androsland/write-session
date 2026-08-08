# TODOS

## Verification gaps

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
- **Six assertions self-skip on Windows** (security review, 2026-08-08): the
  hostile-dirty-path case (Windows forbids `<` and `>` in filenames) and five symlink cases
  (creating a symlink needs elevation). All six were run under WSL/Linux on 2026-08-08 and
  pass — 158/158 there vs 152/152 on Windows. There is still no CI, so nothing re-runs the
  Linux side automatically; add a GitHub Actions matrix.
- **`LOCK_STALE_MS` (15 s) is shorter than the worst-case critical section (~24 s)**
  (security review, 2026-08-08). `withLock` runs six git subprocesses inside the lock, each
  capped at `GIT_TIMEOUT` (4000 ms), so a legitimately slow invocation can hold the lock past
  the threshold at which a *second* session declares it stale and breaks it — after which two
  writers race the read-splice-write of `SESSION.md` and one narrative update is silently
  dropped. Pre-existing and outside this round's diff, so not fixed here; the sweep now leaves
  the threshold alone entirely rather than building on it (see the `.lock` entry under
  Completed), so nothing here depends on `LOCK_STALE_MS` being right. Note the bar is
  already low: `withLock` fails open unconditionally after `LOCK_WAIT_MS` (3 s), so
  unsynchronised concurrent writers are an accepted state at a much shorter timescale.
  Real fix is either a threshold derived from `6 * GIT_TIMEOUT` plus headroom, or a lock that
  carries the owner's pid and is validated rather than aged.
- **The lock race is not unit-testable** (security review, 2026-08-08). Fixtures j/k/l/m
  cover the sweep's arms by mtime, but every one of them uses a lock nobody holds. Nothing
  exercises an aged-yet-live lock, which needs real concurrency. The 8-process contention test
  under Completed is the closest thing and it does not hold a lock past 15 s. If the item above
  is ever fixed, build the harness first — a threshold change with no failing test is
  indistinguishable from a constant bump.
- **`STATE_TTL_MS` silently carries a second requirement** (security review, 2026-08-08).
  Since the sweep reclaims an abandoned `.lock` at that threshold, it must stay far above the
  longest a legitimate critical section can hold the lock (~24 s today). Shortened toward that
  — say, an env override added for faster cleanup — the sweep's own `rmdirSync` starts breaking
  locks live processes still hold, which is precisely why the first two versions of that branch
  were rejected. Not reachable today: `STATE_TTL_MS`, `GIT_TIMEOUT` and `LOCK_STALE_MS` are all
  compile-time constants, none of them routed through `num()`/`ENV`. Recorded because the
  mirror-image entry for `LOCK_STALE_MS` above already exists and this one did not, which is
  the asymmetry that lets a latent invariant get edited away. There is a comment at the
  declaration; a startup assertion would be better. Give the lock its own floor if retention
  ever becomes tunable.
- **The `.lock` reclaim is an `lstat`-then-`rmdir` TOCTOU** (privacy review, 2026-08-08). A
  session that breaks the same already-stale lock via `withLock` in the gap between those two
  calls has its brand-new lock deleted by the sweep. Inherent to any age-based external reclaim
  of a directory another process may re-acquire, and not introduced by the two-arm collapse.
  Left alone deliberately: it needs a 7-day-stale lock, a revisit to that exact anchor, and a
  sub-millisecond landing, and the consequence — two unsynchronised writers — is already an
  accepted state at a far shorter timescale, since `withLock` fails open after `LOCK_WAIT_MS`
  (3 s) regardless. Fixing it properly means an owner-token lock, i.e. the same rewrite the
  `LOCK_STALE_MS` entry above calls for; do both or neither.
- **The git half is silently empty when the session's cwd is not the repo being edited**
  (measurement, 2026-08-08). The anchor is the working directory carried in that turn's Stop
  payload — `const cwd = input.cwd || process.cwd()`, `repoRoot = git(cwd, ['rev-parse',
  '--show-toplevel'])`, then `anchor = repoRoot || cwd` (`hooks/session-md.mjs:864,867,876`)
  — so a session run from a home or scratch directory that edits a repo somewhere else
  records `- Not a git repository (…)` for as long as it stays there.
  Branch, HEAD, dirty files and recent commits are all absent, and nothing in the file
  indicates they were expected, so it reads as "this isn't a repo" rather than "the anchor
  missed". Observed on a real session with a 6.3 MB transcript: the whole git block was that
  one line while every edit landed in a repo two directories away. That is the free half of
  the value proposition producing nothing, undetected.
  Structurally hard rather than merely undocumented: the Stop payload carries `session_id`,
  `transcript_path`, `cwd`, `hook_event_name`, `stop_hook_active` and
  `last_assistant_message` and **no list of edited paths**, so the hook has no cheap way to
  learn where the work actually went. Inferring it would mean parsing the transcript every
  turn, which is precisely the cost this design exists to avoid. Recorded as a known limit
  in the README rather than fixed; revisit if the payload ever grows an edited-files field,
  or if some other cheap signal turns out to be available. Note that a fix would also have
  to decide which repo wins when a session touches several — the current rule has the
  virtue of being unambiguous.
- **A mid-session `cd` relocates `SESSION.md`, and the file left behind still looks current**
  (measurement, 2026-08-08). Same anchor rule as the entry above, read from the other side:
  because `cwd` comes from each turn's Stop payload rather than from where the session began,
  a directory change moves `stateDir` for every subsequent turn. Outside a repo — where the
  slug is the working directory itself — that means a second `~/.claude/write-session/<slug>/`
  appears mid-session while the first freezes at whatever it last said. Neither file points at
  the other and both are well-formed, so a resume that reads the original path silently gets
  stale state. Observed on Windows: a session started in the user's home directory (not a
  repo) wrote its `SESSION.md` under the home slug at 22:21; one turn ran `cd` into
  `~/.claude/projects/<project>/` and at 22:28 a second state directory appeared, slugged
  from that path, carrying its own `SESSION.md` and its own `turns-<sid>.json` — with no turn
  file for that session left in the original directory. Inside a repo the anchor collapses to the repo root, so this is
  invisible for ordinary in-repo work and fires only when a session crosses into a different
  repo — but the plugin's documented home for a non-repo session is exactly the case that
  breaks, and an *agent* running `cd` triggers it with the user never having typed one.
  Not fixed, and the fix is a genuine trade-off rather than an oversight: pinning the anchor
  to the first cwd seen for a session id would remove the relocation *and* remove the
  `cd`-into-the-repo remedy the
  README recommends for the empty-git-half limit above — the two behaviours are the same line
  of code. Deciding which one wins needs a view on which failure is worse; recorded so the
  next person changing that line knows both are riding on it. Note the state to implement a
  pin does not exist yet: `turns-<sid>.json` is keyed by session but lives *inside* the
  per-anchor directory, so once the anchor moves there is nothing left to read the original
  cwd back from — it would need a new session-keyed record at the state root, and that is a
  fourth thing for the sweep to age out. Blind spot either way: the hook
  cannot tell an incidental `cd` from a real move of the work, so no rule here can be right
  in every case. Documented in the README's known limits meanwhile.
- **The ReDoS timing budget is wall-clock and machine-dependent** (build, 2026-08-08). The
  250 ms per-pattern budget and the 8x scaling ratio were calibrated on this machine; the
  worst pattern currently sits at ~11 ms, so there is ~23x headroom, but a much slower CI
  box could still flake. If that happens, scale the budget off a measured baseline rather
  than raising the constant — raising it is how the assertion goes quiet again.
- **`writeAtomic`'s fallback is still not exercised by the suite** (build, 2026-08-08). It
  no longer relies on an `lstat` check — the TOCTOU that was is now an `O_NOFOLLOW` open, so
  the refusal is atomic — but the branch only runs when `renameSync` itself fails, which the
  suite does not simulate. On Windows `O_NOFOLLOW` does not exist and the open degrades to a
  plain create; symlink creation there needs elevation, so the residual risk is small but
  real. Both facts are in the README's "Known limits". The lock-path guard beside it *is* a
  real regression test: 3099 ms unguarded vs 70 ms guarded.

## Design decisions to revisit

- **Caps are tuned to one user's profile** (build, 2026-08-08): 6 turns × 400 chars was
  chosen against Opus sessions running ~240k median context. A smaller model with 40k
  sessions probably wants different numbers. They are env-configurable, but the defaults
  have no evidence behind them beyond one person's usage.
- **State dir renamed `~/.claude/session-md` → `~/.claude/write-session`** (build,
  2026-08-08). Anyone migrating from the hand-rolled hook will leave the old directory
  behind. Harmless (6 turns of scratch) but undocumented cleanup.
- **Secret scrubbing is pattern-based and will always have a floor** (privacy review,
  2026-08-08). It cannot catch a credential that looks like prose, an internal hostname,
  or a customer name. Documented as best-effort in the README and in the source; revisit
  only if a materially better approach exists that does not cost model tokens — an
  LLM-based scrubber would defeat the entire premise of a zero-token hook.
- **Two git subprocesses per turn were added for the ignore verification** (privacy fix,
  2026-08-08): `rev-parse --git-path` plus `check-ignore`. Re-checking every turn is
  deliberate — it catches a `SESSION.md` that gets committed mid-session — but if the
  per-turn cost ever matters, cache the verdict per repo with an mtime guard on
  `info/exclude`.

## Completed

- Split-checkpoint hook + `/write-session` command built and verified single-session
  (2026-08-07), packaged as a plugin (2026-08-08).
- Concurrency exercised under real contention (2026-08-08): 8 simultaneous hook processes
  against one repo — narrative sentinel survived, file untorn, writers merged, no stale
  lock, no temp files left behind.
- **PRIVACY CRITICAL — exclude was a no-op inside a linked worktree** (privacy review,
  2026-08-08). `rev-parse --absolute-git-dir` resolves to `.git/worktrees/<name>`, whose
  `info/exclude` git never reads, so `SESSION.md` stayed untracked-and-visible and was
  committable by `git add -A`. Fixed with `rev-parse --git-path info/exclude` resolved
  against the repo root (that command returns a relative path in a plain repo and an
  absolute one in a worktree — both verified), plus a `check-ignore` verification that
  writes a visible warning into the file when the exclude did not take.
- **SECURITY HIGH — git metadata could forge region markers** (security review,
  2026-08-08). A commit subject containing `<!-- session-md:auto:end -->` was interpolated
  unsanitized while `spliceAuto` matched the first `indexOf`; reproduced at 11 markers
  instead of 1 with stale blocks accumulating. Fixed by neutralising `<`, `>` and
  backticks in every git-derived string, capping dirty-path length, matching markers
  line-anchored, and splicing at the last `auto:end`.
- **PRIVACY HIGH — no secret redaction in turn excerpts** (privacy review, 2026-08-08).
  Added best-effort scrubbing of high-confidence credential shapes with a
  `WRITE_SESSION_REDACT=0` opt-out, documented as best-effort in both the README and the
  source.
- **PRIVACY HIGH — README described installation before disclosing what gets written**
  (privacy review, 2026-08-08). Added a "What it writes to disk — read this first" section
  above Quick start.
- **PRIVACY MEDIUM — TTL pruning only fired on revisited repos** (privacy review,
  2026-08-08). Added a rate-limited (24h) sweep of the whole state root that only ever
  deletes `turns-*.json` and only removes a directory once genuinely empty.
- **PRIVACY MEDIUM — the sweep left an orphaned `SESSION.md` behind forever** (own review
  of the fix above, 2026-08-08). Under `WRITE_SESSION_LOCATION=home` the `SESSION.md`
  lives in the state directory too; the sweep aged out the `turns-*.json` beside it and
  then counted the `SESSION.md` as "not ours to delete", so the excerpts outlived the
  history they came from. Retention was therefore *not* bounded on every path, which is
  what the first draft of this entry and of `CHANGELOG.md` claimed. Now an orphan is
  retired when no live turn file remains beside it, nothing else is in the directory, and
  its own mtime is past the TTL — a foreign file still stops the deletion cold.
- **PRIVACY HIGH — git metadata was scrubbed for markdown but not for secrets** (privacy
  review, 2026-08-08). A branch named after a token, or a commit subject quoting one, went
  in verbatim — the more automatic of the two paths, since nobody has to type anything.
  Git-derived strings now go through the same redactor as assistant text.
- **SECURITY HIGH — four redaction patterns were quadratic** (own measurement, 2026-08-08).
  All four share one shape: an unbounded quantifier before a required literal. The URL
  scheme cost 329 ms / 1.5 s / 5.7 s / 34.7 s at 20/40/80/200 KB against a 15 s harness
  timeout; the PEM pattern re-scanned the tail once per `BEGIN` with no `END`; the JWT
  pattern cost 115/457/1910 ms at 16/32/64 KB; the `PASSWORD=`/`TOKEN=` assignment pattern
  cost 50/201/811 ms. All bounded, input capped at 64 KB before scanning.

  Two review claims were wrong along the way and both are worth recording. The security
  review said all non-PEM patterns were linear — the URL scheme was not. It then said 14 of
  15 were linear and only the JWT was quadratic — the assignment pattern was not, and
  neither of us had timed it, because the extractor silently skipped it. In both cases the
  claim was believed because a *test* said so, and the test was the thing that was wrong.
- **My own ReDoS test claimed coverage it did not have — four separate times** (own review
  + security/privacy review, 2026-08-08). Worth recording as a set, because they are the
  same mistake wearing four costumes and every one of them was silent:
  1. The corpus used a single occurrence of each token head — precisely the shape that
     cannot trigger a restart-per-boundary blowup. 18 ms reported while two patterns were
     quadratic. Now eight separators per head.
  2. The pattern extractor required `[` immediately before the literal, so a multi-line
     pattern was never timed at all: 14 of 15, with nothing indicating a gap. Now
     line-anchored, with a count cross-check against the declared replacement strings.
  3. The length-sensitivity cases asserted only that the hook ran fast, never that the
     secret was gone — which is how a fix that stopped redacting oversized tokens
     *entirely* passed a green suite. Every case now asserts absence, and all were
     confirmed to fail against the broken version before being kept.
  4. The linear-scaling assertion ran only for patterns over 30 ms, so once the patterns
     got fast it stopped running and the assertion count silently dropped by one. It now
     always runs for the three slowest, with an absolute bound when a ratio is untimeable.
     (It had also compared 2x inputs, separating quadratic from linear by only 26% — one
     false PASS on a loaded box. Now 4x: 15.5x/16.6x quadratic vs 1.0x/4.1x linear.)

  The through-line: every one of these was a test that could not fail for the reason it
  existed. Worth checking for directly, rather than trusting a green suite.
- **Fixing a bug is not sweeping for its siblings** (privacy review, 2026-08-08). Two
  patterns were fixed for the bounded-span total-miss defect; a third with the identical
  shape sat two lines below them and shipped through that whole round, because its tests
  used 9- and 18-character passwords and so could not fail at the length that mattered. The
  cheap move that would have caught it: after fixing a defect, restate it as a *shape* and
  grep the file for that shape, rather than for the symptom already seen.
- **My own "CRLF fix" fixed nothing and made the output slightly worse** (own review,
  2026-08-08). Diagnosed a bare `$` as failing to match on a CRLF file; `\r` is a JavaScript
  line terminator, so it always matched. The `\r?$` remedy then *consumed* the carriage
  return and left mixed line endings behind. Both the code comment and the CHANGELOG entry
  asserted the false diagnosis confidently, and no test existed — a claim in a durable
  artifact with nothing behind it. The regression test written afterwards failed against the
  "fix" on the first run, which is how it was caught.
- **PRIVACY HIGH — my own ReDoS fix introduced a redaction hole** (privacy review,
  independently confirmed, 2026-08-08). Bounding a span does not truncate a long match, it
  fails it: at `{8,1024}` a JWT with an 1100-char payload was written out in full cleartext,
  and an identifier with >64 chars before the keyword leaked its value. Both reviewers found
  it; I had already documented the JWT case in a source comment as "redacts only its head",
  which was wrong in the direction that mattered. Fixed by removing the *required literal*
  rather than bounding the span — see CHANGELOG. Residual limit (>256 chars between keyword
  and `=`) is now asserted in the suite so it reads as a limit, not as coverage.
- **SECURITY LOW — the state-root sweep followed symlinked directories** (own review,
  2026-08-08). `readdirSync` resolves a symlink to its target, so a link planted in the
  shared state root would have had the target's `turns-*.json` aged out. Now `lstat`-gated,
  matching the lock-path guard. The orphan-`SESSION.md` retirement above also gained an
  authorship sentinel: it must carry this hook's own marker, since the filename alone is
  not proof that we wrote it.
- **The hook source was binary to git** (own review, 2026-08-08). `mdsafe`'s character
  class held raw control bytes, which parse fine as JavaScript but make the file
  undiffable and unreviewable. Replaced with `\x` escapes before the diff ever reached a
  reviewer.
- Published at `github.com/androsland/write-session` with description and topics
  (2026-08-08).
- Test suites moved into the repo as `test/core.test.mjs` and `test/hardening.test.mjs`
  with a `test/run.mjs` runner (2026-08-08) — committed tooling must be tracked, and both
  vulnerabilities above now have regression coverage. 207 assertions (49 + 158), all green
  on Linux; 201 on Windows with the six platform skips noted above.
- **PRIVACY HIGH — the URL-credential pattern missed any credential past 256 characters**
  (privacy review, 2026-08-08). Same bounded-span defect as the JWT and assignment patterns,
  left behind by the round that fixed those two. Both spans unbounded; linearity re-measured
  (1.7/6.6/26.5/103.7 ms at 16/64/256/1024 KB) rather than argued.
- **PRIVACY MEDIUM — the temp-file sweep covered only the non-default location** (privacy
  review, 2026-08-08). It walked the state root, while in the default configuration the temp
  file lands in the user's repo root. Repo root now swept on the same hour-long clock; the
  "only on the next turn in that repo" limit is stated in the README rather than implied.
- **SECURITY LOW — the temp-file sweep matched a bare `.tmp-` substring** (security review,
  2026-08-08). Anchored to the two basenames the hook actually writes.
- **PRIVACY MEDIUM — a stale `.lock` reopened the orphan-retention gap** (privacy review,
  2026-08-08). A leftover lock directory counted as "something else in the directory", so the
  `others.length === 1` retirement could never fire, and `withLock` only breaks a stale lock
  when a run takes that lock again — which an unrevisited anchor never does. The sweep now
  handles it directly: a lock counts toward `others` and blocks retirement until it is itself
  past `STATE_TTL_MS`, then the directory is reclaimed. Took three attempts, and the two dead
  ends are the lesson. Reclaiming at `LOCK_STALE_MS` can free a lock a live process still
  holds, with no defined successor, triggered by any hook run anywhere rather than by
  contention on that anchor. Splitting the difference — ignore at 15 s, remove at 7 days —
  read as the careful compromise and was the worst of the three: a writer reads `SESSION.md`
  only *after* its six git subprocesses, so the 15–24 s band is exactly when a live run has
  not read the file yet, and retiring it there drops the user's narrative silently. Three
  shapes worth keeping: a retention fix can be correct while the bookkeeping around it is not;
  reaching for a delete because the adjacent code deletes things is not the same as needing
  one; and an extra threshold presented as caution can hide a window that neither endpoint
  had — check what a middle band is *for*, not just that it is narrower.
- **PRIVACY LOW — `LOCATION=home` stranded an already-orphaned repo-root temp file**
  (privacy review, 2026-08-08). The sweep was gated on the write path, so opting out of
  writing into the repo also opted out of cleaning what was already there. Gated on the repo
  root instead.
- **Teeth-checking needs one mutation per arm, not one per defect** (own review, 2026-08-08).
  Reverting the two under-deletion defects failed 3 assertions and left the 3 "must be kept"
  assertions green, which reads as coverage and is not. An opposite mutation (unconditional
  lock removal) was needed for those. The `.lock` arms got the same treatment once the branch
  settled: never reclaiming reproduces the original bug, reclaiming at any age reproduces both
  rejected versions. Four passes, twelve failures. Where assertions guard a threshold, mutate
  every arm or state which is unproven — one assertion here pins an outcome whose guard is
  observably redundant with the surrounding catch, so no mutation of it can fail; the CHANGELOG
  says that outright instead of letting a test that passes either way read as coverage.
