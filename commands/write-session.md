---
description: Fill the narrative half of SESSION.md in one pass, then /clear
---

Write the **narrative half** of `SESSION.md`.

Extra instructions (optional): $ARGUMENTS

## The file is split — you only own half of it

The `write-session` **Stop hook** already maintains the mechanical half at zero model
tokens, regenerating it on every turn end: branch, HEAD, dirty files, diffstat, recent
commits, and a truncated tail of the last few turns. It lives between
`<!-- session-md:auto:start -->` and `<!-- session-md:auto:end -->`.

**Never write git state, file lists, or a recap of recent turns — the hook has them.**
Duplicating them wastes the exact tokens this command exists to save.

You own only the region between `<!-- session-md:narrative:start -->` and
`<!-- session-md:narrative:end -->`: the part git cannot reconstruct.

## Rules

- **One pass, one request.** Locate the file, read it, `Edit` the narrative region — all
  in a single tool batch. Do not iterate, do not re-read to verify, do not ask follow-up
  questions. In a deep session every extra round trip re-reads the whole conversation
  prefix; that is the entire cost of this command and it is why it is capped at one.
- **Edit, never Write.** A full overwrite clobbers the hook's auto block. (It self-heals
  on the next turn end, but you lose the turn tail.)
- **Location** — mirrors the hook's rule: repo root when `cwd` is inside a git repo,
  otherwise `~/.claude/write-session/<slugified-path>/SESSION.md`. If
  `WRITE_SESSION_LOCATION=home` is set it is always the latter. If the file does not
  exist yet the hook has not fired; create it at that path with both marker pairs.
- **Gitignore is already handled** — the hook adds `/SESSION.md` to `.git/info/exclude`,
  which is local-only and never appears in a diff. Do not touch the tracked `.gitignore`.
- **Durable follow-ups do not belong here.** Anything outliving this session goes to
  `TODOS.md`. `SESSION.md` is scratch: where I am now, and how to resume.
- Keep the narrative under ~1.5k tokens. It is read into a fresh session's prefix and
  re-read on every subsequent request there, so length is not free.

## Narrative template

```markdown
## Where we are
<2-4 sentences: what's done, what's mid-flight, what's blocked. No git state.>

## Decisions made
- <decision> — <why, one line>

## Dead ends (do not retry)
- <what was tried> — <why it failed>

## Next steps
1. <concrete next action>
2. ...

## Key files
- `path/to/file` — <why it matters, not what it contains>
```

After writing, state the path and one line on what it captured, then remind me to
`/clear` and resume with "read SESSION.md and continue". Nothing else.
