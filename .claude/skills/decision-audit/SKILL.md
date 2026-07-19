---
name: decision-audit
description: "Review an AI-authored change by its DECISIONS, not its diff. Extracts the choices the AI made where the task was underspecified — algorithm, schema, error handling, fallbacks, magic numbers, concurrency — ranks them by risk, and hunts the 'coincidental success' failure mode (a local fix that passes tests but masks the root cause). Use as the gate between 'AI says done' and 'merge', after /check passes and alongside /code-review. Invoke when asked to 'audit the decisions', 'what choices did the AI make', 'decision review', or before merging an AI-heavy change."
argument-hint: "[nothing = working-tree diff | main | <branch> | a task/subagent just finished]"
allowed-tools: ["Read", "Grep", "Glob", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git status:*)", "Agent", "AskUserQuestion"]
---

# Decision Audit — review the choices, not the code

Premise (from Victor Taelin's "audit the choices, not the code"): a large AI diff
contains only a handful of real *decisions*; the rest is mechanical execution. The AI
implements a well-specified plan near-perfectly, but where the task was **silent** it makes
choices — and some are silently wrong. Bugs of *execution* are caught by tests and
`/code-review`. Bugs of *judgment* are not. This skill surfaces the judgment calls so a
human reviews the ~10 decisions instead of the ~1000 lines.

**This is not a bug hunt.** It complements, does not replace:
- `/check` — the provable-failure oracle (`bun run check`, `bun run lint`, server tests).
- `/code-review` — line-level correctness + cleanup.

Run this AFTER `/check` is green.

## Scope

Determine what to audit:
- **No arg** → working-tree diff: `git diff HEAD` (staged + unstaged).
- `main` / a branch name → `git diff main...HEAD` (or the named base).
- A task/change a subagent just completed → use that diff, and if the implementing
  context is still live, ALSO ask it directly (track A below).

## Procedure

### 1. Get the diff and the intent
`git diff <scope>` for the changes; `git log`/the task text for what was *asked*. The gap
between "what was asked" and "what the diff does" is where decisions live.

### 2. Extract decisions — two tracks, use both

**Track A — self-report (when an implementing agent/context is available).**
Ask, verbatim:
> "While making this change, which choices did you make that you are NOT confident of?
> List all — where the task was underspecified and you picked one option over others."
Then carry that list into step 3. (In a single session this is honest self-reflection
over what was just built; via `Agent` it's a question to the implementer.)

**Track B — infer from the diff (always).** Scan for decision points where the task
didn't dictate the answer. In THIS repo, weight these hot spots:
- **SQLite schema / migrations** — new columns, types, nullability, `ON DELETE` behavior,
  the auto-migration path (`server/src/db`). A wrong FK rule or default is a judgment bug.
- **Timestamp cascade** — any change near `inboxAt`/`inProgressAt`/`doneAt` logic.
- **Error handling & fallbacks** — swallowed catches, the Claude CLI→API fallback chain,
  default-on-failure behavior. "Chose to fall back silently" is a decision.
- **Concurrency / timing** — debounce (2s), poll intervals (30s/5s), the sheets anti-loop
  guard (10s), async ordering, race windows.
- **Magic numbers / limits** — virtual-scroll batch (15), timeouts, buffer/page sizes.
  Ask: is this value principled or did it just happen to work here?
- **Data shape / API contract** — response fields, `shared/` types, JSON snapshot format.
- **Security defaults** — token encryption, URL validation (`script.google.com`, sheet
  URLs), anything touching secrets or external input.
- **Naming that encodes semantics** — a name asserting a guarantee the code doesn't keep.

### 3. Classify and keep only AI-made choices
For each candidate: was it **dictated by the task** (skip) or **chosen by the AI** (keep)?
Only judgment calls matter here.

### 4. Hunt "coincidental success" (the signature AI failure)
For each kept decision, ask specifically:
- Does this fix the **root cause**, or mask a symptom that coincidentally makes the case
  at hand pass? (Taelin's example: doubling a buffer "fixed" MatMul while the real bug
  stayed dormant.)
- Is the solution **general**, or a special-case that works only for the tested input?
- Did the AI **declare success on green tests** when the tests don't actually cover the
  general case?
Flag any decision that passes tests but doesn't address the underlying issue — this class
is invisible to `/check`.

### 5. Report — ranked, short
Output a table sorted by risk (highest first). One row per decision:

| # | Risk | Decision (file:line) | What was chosen | Why it may be wrong | How to verify |

- **Risk** = High / Med / Low by blast radius × likelihood-wrong.
- Keep it to the decisions that matter — a handful, not the whole diff.
- End with an explicit recommendation per High item: accept / clarify with author /
  request a more general fix.

## Honest limits (state these in the output)
- **Self-report is partial.** It only catches choices the AI *knows* it was unsure of.
  Confident-but-wrong choices won't surface from Track A — Track B and tests must catch
  those.
- **Not a substitute for tests.** Judgment audit + `/check` + `/code-review` together;
  none alone is sufficient.
- **Never fabricate confidence.** If a decision's correctness can't be determined from the
  diff, say so and route it to the author, don't guess.
