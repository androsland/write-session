# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[SemVer](https://semver.org/spec/v2.0.0.html).

## [0.1.1] — 2026-08-08

Security and privacy fixes found by a pre-release review of 0.1.0. **0.1.0 was pushed to
`main` and was therefore installable via the marketplace, but never tagged or released.**
If you installed from `main` on 2026-08-08, update.

### Fixed

- **Privacy (critical): `SESSION.md` was not excluded inside a linked git worktree.** The
  exclude path was resolved with `git rev-parse --absolute-git-dir`, which inside a
  worktree yields `.git/worktrees/<name>` — a directory whose `info/exclude` git never
  reads. The file therefore stayed visible to `git status` and would be committed by a
  `git add -A`, publishing conversation excerpts. Now resolved with
  `git rev-parse --git-path info/exclude` (relative in a plain repo, absolute in a
  worktree — resolved against the repo root either way).
- **Privacy (critical): the exclude result is now verified, not assumed.** Every turn runs
  `git check-ignore`; if `SESSION.md` is still not ignored — a read-only `.git`, or a repo
  that already tracks a `SESSION.md` — a warning banner is written into the file itself
  instead of failing silently.
- **Security (high): git metadata could forge the region markers.** A commit subject,
  branch name or dirty path containing `<!-- session-md:auto:end -->` was interpolated
  into `SESSION.md` unsanitized, while the splice matched the *first* `indexOf` of the end
  marker. Cloning a hostile repo and running five turns produced eleven `auto:end` markers
  with duplicated stale blocks; because `SESSION.md` is meant to be read back into a fresh
  agent session, a forged `narrative` region is prompt injection. Every git-derived string
  is now markdown-neutralised (`<`, `>`, backticks) and length-capped, markers are matched
  line-anchored, and the splice takes the **last** `auto:end`.
- **Privacy (high): assistant turn excerpts were written verbatim.** Added best-effort
  scrubbing of high-confidence credential shapes — private-key blocks, `sk-`/`sk-ant-`,
  Stripe-style `sk_live_`/`rk_test_`, `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`/`github_pat_`,
  `npm_`, `pypi-`, `xox*-`, `AKIA…`, `AIza…`, JWTs, `Bearer`/`Basic` headers,
  `PASSWORD=`/`SECRET=`/`TOKEN=`/`CONNECTION_STRING=`-style assignments, and credentials
  embedded in URLs. This is a seatbelt, not a guarantee; `WRITE_SESSION_REDACT=0` opts out.
- **Privacy (high): git metadata was markdown-neutralised but never scrubbed for secrets.**
  A branch named after a token or a commit subject quoting one went into `SESSION.md`
  verbatim — and unlike assistant text, that path needs nobody to type anything. Branch,
  HEAD subject, repo root, dirty paths, recent commit subjects and `cwd` now go through the
  same redactor.
- **Security (high): four redaction patterns were quadratic in input length.** Every one
  had the same shape — an unbounded quantifier before a required literal, so a repeated-head
  input restarts the match at each boundary and each restart scans to end-of-string. The
  unbounded scheme in the URL-credential pattern measured 329 ms / 1.5 s / 5.7 s / 34.7 s at
  20/40/80/200 KB against a 15 s hook timeout; the private-key pattern re-scanned the
  remaining string once per `BEGIN` when no `END` followed; the JWT pattern cost
  115/457/1910 ms at 16/32/64 KB on `'eyJ-'.repeat(n)`; the `PASSWORD=`/`TOKEN=` assignment
  pattern cost 50/201/811 ms on `'DSN_'.repeat(n)`. Input is also capped at 64 KB before
  scanning, and the output truncated to 400 characters regardless.
- **Privacy (high): the first version of that ReDoS fix stopped redacting oversized
  secrets entirely.** Bounding a span does not shorten a long match — it *fails* it. With
  the JWT segments capped at 1024, a token with an 1100-character payload was written to
  `SESSION.md` in full cleartext; `\b` only fires at the true start of the token, so no
  later position could rescue the match. The same applied to identifiers with more than 64
  characters before the keyword (`SPRING_DATASOURCE_..._PASSWORD=`). Both were verified at
  1100/4000/20000-character payloads and 64/200/2000-character prefixes.

  The shipped fix keeps the ReDoS property without the hole, by removing the *required
  literal* rather than bounding the span. The JWT pattern is now one greedy run over the
  whole token, dots included, with nothing required after it — no trailing requirement means
  no backtracking at any length, measured 0.7 ms on `'eyJ-'.repeat(16384)` versus 1886 ms
  for the three-segment version and 69 ms for the bounded one. For the assignment pattern
  only the *suffix* is bounded (to 256), because only the suffix was quadratic: the prefix
  backtracks once from the single position where `\b` fires, so it costs O(n) overall and is
  unbounded again. 902 ms → 14 ms at 64 KB, with every prefix length redacting.

  Residual limit, asserted in the suite so it cannot read as coverage: more than 256
  characters *between* the keyword and the `=` still misses.
- **Privacy (high): the URL-credential pattern had the same hole, and survived the round
  that fixed the other two.** Its username and password spans were both bounded at 256, so a
  257-character password meant the entire connection string — scheme, user, password, host —
  went into `SESSION.md` untouched. Not a contrived length: an Azure SAS token or a long API
  key used as a DSN password clears it easily. Verified at 257, 1000 and 20000 characters, on
  the username and the password independently.

  Both spans are unbounded now. The `@` has to stay a required literal — without it every
  `host:port` URL would be redacted — so this pattern cannot use the trick the JWT one does;
  instead the runs are safe because both character classes exclude `/` while every start
  position requires `://`, so no run can extend into the next candidate. Measured linear:
  1.7/6.6/26.5/103.7 ms at 16/64/256/1024 KB, against 1.3/5.2/19.5/78.6 ms bounded. Only the
  scheme stays bounded, since the scheme was the measured 34.7 s case — and that bound costs
  no coverage, because nothing anchors the pattern to the scheme's start: a 20-character
  scheme simply matches four characters later (asserted at 8/16/17/40).

  The generalisable part is not the pattern. Two patterns were fixed for this exact defect
  one round earlier while a third sat beside them with the same shape, and its tests used
  9- and 18-character passwords — lengths at which it could not fail. Fixing a bug is not
  sweeping for its siblings.

  The last two were found only after the first timing assertion was rebuilt, and how they
  hid is the more useful half of this entry. That assertion timed a single occurrence of
  each token prefix — the one input shape that cannot trigger this class of blowup — and
  reported 18 ms while both patterns were quadratic. Fixing the corpus exposed a second
  gap: the regex that scraped patterns out of the source required `[` immediately before
  the literal, so the multi-line assignment pattern was never timed at all, 14 of 15. The
  suite now repeats each prefix against eight separators, asserts that the number of
  patterns extracted equals the number declared, and re-times slow patterns at quarter
  size, because a 2x span separated quadratic from linear by only 26% and had already
  produced one false PASS on a loaded machine.
- **Security (low): a non-directory squatting on the lock path wedged every turn.**
  `rmdirSync` on a symlink throws `ENOTDIR` forever, so each turn burned the full 3 s lock
  wait before failing open — measured 3099 ms vs 70 ms once cleared.
- **Security (medium): `writeAtomic`'s fallback had a TOCTOU race.** It was an
  `lstat`-then-`writeFileSync`, which is check-then-act: anyone able to write in that
  directory could swap a symlink in between the two calls — and could force `renameSync` to
  fail on purpose to reach the branch at all. It now opens with `O_NOFOLLOW`, so the refusal
  happens inside the syscall with no window to race. `O_NOFOLLOW` does not exist on Windows
  and degrades to a plain create there; documented as a limit rather than papered over.
- **Privacy (medium): a killed process left a temp file holding the full content.**
  `SESSION.md.tmp-<pid>` is not matched by the exact-name `/SESSION.md` exclude, so it sat
  in the repo untracked and would have been picked up by any `git add -A` — no `-f`, no
  intent required. The exclude now carries `/SESSION.md.tmp-*` as well, the sweep retires
  orphaned temp files after an hour, and `writeAtomic` cleans up in a `finally` (which
  covers the exception path only — a SIGKILL runs no JavaScript, which is exactly why the
  exclude and the sweep both exist).
- **Privacy (medium): that temp-file sweep only covered the configuration nobody runs.** It
  walked the state root, and in the default configuration the temp file lands beside its
  target — your repo root — which the sweep never visited. So the complete copy of the
  checkpoint stayed there indefinitely: git-excluded, never deleted, and the entry above
  claimed otherwise. The repo root is now swept on the same hour-long clock. It is swept on
  the next turn in that repo rather than on a timer, which is a real limit and is stated in
  the README: this hook has no background process and is not going to grow one.
- **Security (low): the temp-file sweep matched on a bare substring.** `n.includes('.tmp-')`
  would have deleted any aged file in the state directory whose name merely contains that
  text — `notes.tmp-2026.md`, an editor swap file — contradicting the rule the branch beside
  it states outright, "never delete anything but our own files". Now anchored to the two
  basenames this hook actually writes.
- **Privacy (medium): a stale `.lock` pinned an orphaned `SESSION.md` in place forever.**
  The orphan retirement two entries down fires only when the directory holds nothing but the
  `SESSION.md`, and a `.lock` directory left behind by a SIGKILL counted as "something else".
  `withLock` breaks a stale lock, but only when a run takes that lock again — and an anchor
  nobody revisits never gets one, which is the same precondition as being an orphan. So a
  zero-byte directory silently reopened the retention gap that fix had just closed, on the
  one path where nothing else would ever notice. The sweep now handles a stale `.lock` itself,
  and only when it is a real directory — a file or symlink squatting on the path stays put.

  This fix took three attempts and the middle one is worth recording, because it was subtly
  worse than either end. Version one reclaimed the lock at `withLock`'s own `LOCK_STALE_MS`
  (15 s); a security review pointed out that a sweep-side break can free a lock a live process
  still holds, and unlike `withLock`'s stale-break — where the breaker `mkdir`s immediately and
  is therefore the defined successor — hands it to whoever arrives next. It is wrong on this
  file's own numbers, too: the critical section runs six git subprocesses at `GIT_TIMEOUT`
  (4000 ms) each, so a legitimately slow run holds the lock for ~24 s.

  Version two split the difference — stop *counting* the lock at 15 s (which touches nothing),
  only *remove* it at `STATE_TTL_MS`. That looked like the careful choice and quietly created a
  data-loss window instead. A writer reads `SESSION.md` only *after* that git work, so a lock
  aged 15–24 s belongs to a run that is still going to read the file. Retiring it there hands a
  live run an empty region to adopt, and the human-written narrative goes without a word.

  So there is one threshold: until `STATE_TTL_MS` a lock counts toward `others` and blocks
  retirement, past it the directory is reclaimed — the same clock the rest of this sweep runs
  on, because an abandoned lock is just more dead state. Giving up the band costs less than it
  looks: a lock is stamped when its owner takes it, so an abandoned one ages with the
  `SESSION.md` from those same turns. The worst case is a crash on the first turn after a long
  absence, which delays that file's retirement by up to one further `STATE_TTL_MS` — bounded,
  where the original bug was not. Both arms are asserted: abandoned lock reclaimed and its
  orphan retired; every younger lock neither removed nor allowed to let the file go.
- **Privacy (low): switching to `LOCATION=home` stranded any repo-root temp file forever.**
  The repo-root sweep was gated on `inRepo`, which goes false the moment you set
  `WRITE_SESSION_LOCATION=home` — so the one action a privacy-conscious user takes after
  finding a checkpoint copy in their repo, stop writing there, was exactly the action that
  guaranteed the copy already sitting there would never be removed. Gated on the repo root
  instead: sweeping a repo we no longer write to costs one `readdir` and matches only our own
  two name shapes past the hour.
- **Security (medium): the orphan authorship sentinel was a substring test.** It accepted
  any file containing the marker text anywhere, not line-anchored — and this project's own
  README and CHANGELOG quote that text, so a user's notes mentioning the plugin would have
  qualified. It now requires both markers on their own lines, the same standard the region
  parser applies.
- **`readTurns` still followed symlinks** while the sweep beside it no longer did. Now
  `lstat`-gated for consistency, and `git diff --shortstat` goes through `gitsafe()` like
  every other git-derived string rather than relying on its current output format.
- **Withdrawn: "marker detection failed on a CRLF file".** An earlier draft of this
  changelog claimed the line-anchored regexes' bare `$` matched nothing on a CRLF-saved
  `SESSION.md` and discarded the whole auto region, and added `\r?$` to fix it. Both halves
  were wrong. `\r` is a JavaScript line terminator, so multiline `$` already asserts before a
  `\r\n` and the region was never lost — and the "fix" made the output slightly worse, since
  `spliceAuto` resumes at `endMatch.index + endMatch[0].length` and a `\r?` that *consumes*
  the marker line's carriage return turns a clean `\r\n\r\n` into a mixed `\n\r\n`. Measured
  on a CRLF fixture three splices deep: bare `$` leaves 2 lone LFs, `\r?$` leaves 3;
  identical on an LF file. Reverted to the bare `$`, with a regression test that fails
  against `\r?$` and passes against what shipped. Nothing was ever broken for users here; the
  entry is kept rather than deleted because a claimed fix that was neither is worth a record.
- **Privacy (medium): stale turn history could accumulate forever.** The 7-day TTL was
  only applied to a directory you came back to, so a repo visited once kept its excerpts
  indefinitely. Added a rate-limited (once per 24h) sweep of the whole state root that
  deletes only `turns-*.json` and removes a directory only when it is genuinely empty.
- **Privacy (medium): that sweep left an orphaned `SESSION.md` behind indefinitely.**
  Under `WRITE_SESSION_LOCATION=home` the `SESSION.md` sits in the state directory too; the
  sweep aged out the turn files beside it and then treated the `SESSION.md` as off-limits,
  so the excerpts outlived the history they came from. An orphan is now retired when no
  live turn file remains beside it, nothing else is in the directory, its own mtime is past
  the TTL, it is a regular file rather than a symlink, and it actually carries this hook's
  marker. The marker check matters: the filename alone is not proof of authorship, so a
  same-named file someone else parked there is left alone. Any other file still stops the
  deletion, and the file is size-capped before being read.
- **Security (low): the state-root sweep would follow a symlinked directory.** `readdirSync`
  resolves a symlink to its target, so a link planted in the shared state root would have
  had the target's `turns-*.json` files aged out. The sweep now `lstat`s each entry and
  skips anything that is not a real directory — the same rule already applied to the lock
  path, applied consistently.
- **The hook source was binary to git.** `mdsafe`'s character class contained raw control
  bytes — valid JavaScript, but enough for git to refuse to diff the file. Rewritten with
  `\x` escapes.

### Added

- `test/` — `core.test.mjs` (49 assertions) and `hardening.test.mjs` (158, regression
  coverage for every fix above), with a `node test/run.mjs` runner. No test framework, no
  dependencies. Six assertions self-skip on Windows (filename and symlink restrictions);
  all 207 pass on Linux. The redaction cases assert the secret is absent from the output,
  not merely that the hook ran fast, and were each confirmed to fail against the broken
  version before being kept.

  The retention assertions were checked in **both** directions, which turned out to matter:
  a single mutation only ever exercises one side, so reintroducing the defects produced 3
  failures and left the three assertions guarding against *over*-deletion green — which reads
  like coverage and is not. Proving those took a second, opposite mutation. The `.lock` arms
  were mutated the same way once the branch settled: never reclaiming reproduces the original
  bug (2 failures), reclaiming at any age reproduces both rejected versions (4 failures,
  including the two that pin the 15–24 s data-loss window). Four mutation passes in all,
  twelve failures, no survivors.

  One assertion is deliberately not teeth-checked, and saying so is the point: the
  non-directory `.lock` case pins an outcome its guard cannot be shown to cause. With the
  `isDirectory()` check the entry goes straight to `others`; without it `rmdirSync` throws
  `ENOTDIR` into the surrounding catch, which pushes it too — identical at every age. The
  guard stays for legibility, but no mutation of it is observable, so it is recorded here
  rather than covered by a test that would pass either way.
- `WRITE_SESSION_REDACT` configuration variable.
- README section **"What it writes to disk — read this first"**, placed above Quick start:
  what lands in the repo, that redaction is best-effort, which git commands now run every
  turn, that repo paths usually embed your OS username, and that `git add -f` still
  overrides the exclude.

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

[0.1.1]: https://github.com/androsland/write-session/releases/tag/v0.1.1
[0.1.0]: https://github.com/androsland/write-session/releases/tag/v0.1.0
