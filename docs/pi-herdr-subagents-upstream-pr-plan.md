# Plan: package `pi-herdr-subagents` changes for upstream review

## Purpose

This document is a handoff for a fresh session. It captures how to split the current `pi-herdr-subagents` feature branch into small, useful pull requests, review those PRs in the `squiddity` fork first, and then reapply or rebase the approved work for the upstream repository.

Do **not** send upstream PRs merely because this document exists. The immediate next phase is reconstruction and internal review in the fork.

## Current internal review status

PRs 1–6 are complete draft PRs in the `squiddity` fork, stacked in order. PR6 — waiting timeout notifications and one-shot snooze — is implemented on `review/06-waiting-timeouts` at commit `6358981`. PR7 — telemetry — remains deferred pending design review. No upstream PRs have been opened.

## Repository and baseline

Local repository:

```text
/home/squiddity/projects/pi-herdr-subagents
```

Remotes:

```text
origin   https://github.com/squiddity/pi-herdr-subagents.git
upstream https://github.com/0xRichardH/pi-herdr-subagents.git
```

Current branch state when this document was written:

```text
main                         d654eae
feat/explicit-extension-mode ea7e784
```

The feature branch is 17 commits ahead of `main`. Its final diff is large:

```text
20 files changed, 4,783 insertions, 175 deletions
```

The current feature branch is a **reference implementation**, not suitable as one upstream PR. Its history contains cross-cutting commits, fixups, a reverted commit, and one especially large commit that combines manual completion, waiting notifications, planner behavior, tests, and documentation.

## Final design decisions already made

Preserve these decisions while reconstructing the PR stack unless new evidence demonstrates a concrete problem.

1. Pi-backed children may use normal extension discovery or an explicit extension runtime.
2. Explicit runtime settings inherit recursively, with independent mode/path overrides.
3. Unknown explicitly named agent profiles fail closed.
4. Named profiles may constrain the exact child profiles they can launch.
5. Recursive orchestrators track descendants and defer completion/auto-exit until descendant results are delivered and processed.
6. `subagent_resume` preserves runtime policy through a bounded JSON sidecar beside the session.
7. Resume profiles are intentionally **unsigned** local runtime manifests. There is no signature, nonce, host key, or session attestation.
8. `subagent_resume` requires a current valid profile. Missing or malformed profiles are refused before pane creation.
9. External, manually created, or old sessions may still be resumed directly with `pi --session`, but not through the tracked `subagent_resume` tool.
10. Profiles preserve policy fields that affect runtime behavior: model, thinking, cwd, named identity, tool allow/deny policy, extension mode and entries, inherited entries, config root, allowed child profiles, and waiting-timeout policy.
11. Waiting timeout fields remain part of profile preservation even though they are new and have little historical usage evidence.
12. Safe parent-driven completion is generation-bound and must never promote aborted, errored, partial, stale, active, or descendant-blocked output into a completed result.
13. Waiting reminders and snoozes are one-shot and generation-bound, not polling or periodic reminders.
14. Telemetry requires separate design review. Do not bundle telemetry into lifecycle or resume PRs merely because the reference branch already contains it.

## Important upstream behavior difference

Upstream currently accepts an arbitrary session path and roughly resumes it as:

```bash
pi --session <session> -e subagent-done.ts
```

That behavior uses the resuming environment's current ambient configuration and does not preserve the original model, tools, denied tools, named profile, extension runtime, child-profile policy, or waiting policy.

The proposed profile PR intentionally narrows `subagent_resume` to sessions created by the extension. This is justified by the tool's promise of a tracked, policy-preserving subagent resume and by the assumption that old sessions do not need to be resumed through this tool. The upstream PR must state this behavior change plainly. Direct `pi --session` remains the escape hatch for external sessions.

## Why the current commits should not be submitted as-is

Useful reference commits include:

| Commit | Reference value | Caution |
|---|---|---|
| `34e1734` | Explicit extension runtime | Later commit substantially simplifies it |
| `5b7ee19` | Recursive extension/completion corrections | Mixes integration behavior with runtime cleanup |
| `a1d9512` | Initial resume profile implementation | Contains removed signature/attestation design |
| `c11bc49` | Fail closed on unknown profiles | Small and mostly independently reusable |
| `8fcad4b` | Child-profile allowlists | Mostly independently reusable |
| `93d7cf5` | Descendant completion guard | Requires later registry separation fix |
| `5bce605` | Separate descendant registries | Must accompany descendant tracking |
| `7aeb8aa` / `bca9903` | Usage telemetry | Defer pending telemetry review |
| `e6b8b13` | Deferred auto-exit | Belongs with descendant lifecycle |
| `50fecbd` | Manual completion and waiting behavior | Far too broad; split manually |
| `37a5e54` | Resume watcher fix | Include in the resume/completion reconstruction |
| `ea7e784` | Unsigned, required resume profiles | Final profile policy; supersedes attestation portions |

Do not simply cherry-pick `a1d9512` or `50fecbd`. Reconstruct each PR from the final tree and use the old commits only to locate relevant code and tests.

## Recommended PR stack

### PR 1 — Fail-closed named-agent policy

#### User-visible promise

Explicitly requested named agents are known, and named parents can restrict which named child profiles they launch.

#### Include

- Reject unknown explicit agent names rather than falling back to bare defaults.
- Parse an exact child-profile allowlist from profile frontmatter/environment.
- Enforce the allowlist before child launch.
- Preserve explicit empty allowlists.
- Focused unit tests.
- Small README/frontmatter documentation update.

#### Exclude

- Resume profiles.
- Extension runtime changes.
- Descendant registries.
- Policy telemetry fields.
- Usage telemetry.

#### Likely source references

- `c11bc49`
- `8fcad4b`
- Exclude telemetry-only `465de36` for now.

#### Acceptance criteria

- Unknown explicit names fail before pane creation.
- Unrestricted, restricted, and explicit-empty child policies are distinct.
- Allowed children launch; denied children fail before side effects.
- Existing unnamed/bare launches retain upstream behavior.

---

### PR 2 — Explicit extension runtime for recursive Pi children

#### User-visible promise

Pi children and recursive descendants can run with a deterministic extension set instead of ambient extension discovery.

#### Include

- `extensionMode: "normal" | "explicit"`.
- Comma-separated caller extension entries.
- Absolute resolution against effective child cwd.
- Deduplication.
- `--no-extensions` plus mandatory extension loading in explicit mode.
- Independent descendant inheritance and override semantics.
- Empty string to clear inherited caller entries.
- Claude-backed rejection for unsupported runtime settings.
- `extension-runtime.ts`, focused tests, and README examples/security boundary.

#### Exclude

- Resume preservation.
- Descendant registries and deferred auto-exit.
- Manual completion.
- Waiting notifications.
- Telemetry.

#### Likely source references

- Final `pi-extension/subagents/extension-runtime.ts`
- `34e1734`
- Relevant corrected portions of `5b7ee19`

#### Acceptance criteria

- Normal mode retains normal Pi discovery and adds requested entries.
- Explicit mode loads only mandatory entries plus requested entries.
- Relative paths are resolved once and exported to descendants as absolute paths.
- Omitted descendant fields inherit independently.
- Explicit descendant values replace inherited values.
- Claude-backed calls reject explicit runtime arguments clearly.

---

### PR 3 — Correct recursive descendant lifecycle and deferred auto-exit

#### User-visible promise

An auto-exiting recursive orchestrator remains alive until tracked descendant results are delivered and processed.

#### Include

- Parent-owned descendant registration.
- Separate child-owned descendant registry.
- Stable registry derivation across resume where applicable to the PR's available behavior.
- Removal of a terminal child before result delivery.
- `subagent_done` refusal while tracked descendants remain.
- Auto-exit deferral while descendants remain.
- Fail-closed behavior for unreadable registries.
- Recursive integration test.
- Lifecycle documentation.

#### Exclude

- Safe parent-driven manual completion.
- Waiting timeout/snooze.
- Resume profiles, unless a tiny neutral hook is strictly required; prefer leaving resume-specific preservation to PR 4.
- Telemetry.

#### Likely source references

- `93d7cf5`
- `5bce605`
- `e6b8b13`

#### Acceptance criteria

- Parent and child registries are never conflated.
- Siblings do not share child-owned registry state.
- An orchestrator cannot complete while a direct descendant remains tracked.
- Final descendant removal precedes steer delivery.
- An auto-exit orchestrator processes the last delivered result and exits on its next completed turn.

---

### PR 4 — Policy-preserving subagent resume profiles

#### User-visible promise

A resumed tracked subagent uses the same runtime policy as its initial Pi-backed launch.

#### Include

- Bounded `<session>.profile.json` sidecar.
- Atomic profile writes.
- Strict schema, regular-file, absolute-path, duplicate, count, and byte-size validation.
- Fields for model, thinking, cwd, named identity, tool allowlist, denied tools, extension mode/entries, inherited entries, config root, and allowed child profiles.
- Require a valid profile for `subagent_resume`.
- Restore named identity and policy environment.
- Reconstruct explicit/normal extension arguments.
- Canonicalize the session path before profile-controlled cwd changes.
- Refuse missing or malformed profiles before pane creation.
- Preserve independent watcher lifetime for resumed sessions.
- Document direct `pi --session` for external sessions.
- Focused profile and resume tests.

#### Add later, in PR 6

- Waiting timeout/message fields, unless PR 6 is developed simultaneously and the stack makes their later addition straightforward.

The final desired state **does** include the timeout fields; avoiding dormant fields in PR 4 simply keeps each PR independently motivated.

#### Exclude

- Signatures, HMAC keys, nonces, attestation metadata, or claims of provenance.
- Old-profile compatibility.
- Profile-less tracked resume fallback.
- Tool-policy telemetry comparison.
- Usage telemetry.

#### Likely source references

- Final `launch-profile.ts` after `ea7e784`
- `safe-file.ts`
- Relevant final `index.ts`, `session.ts`, and resume watcher code
- Do not copy removed attestation code from `a1d9512`.

#### Acceptance criteria

- Every new Pi-backed tracked child gets a profile.
- A valid profile reproduces its runtime arguments and policy environment.
- Missing/malformed/symlinked/special/oversized profiles fail before pane creation.
- No prompt, system prompt, credential, grant, or conversation content appears in the profile.
- Profiles are documented as unsigned local manifests whose executable paths must be trusted.
- External sessions are explicitly directed to raw Pi resume.

---

### PR 5 — Safe parent-driven completion of waiting children

#### User-visible promise

A parent can accept a safely completed manual child without sending Escape or losing the child's final answer.

#### Include

- Completion-aware default behavior for `subagent_interrupt`.
- `finish: false` for explicit turn-only Escape semantics.
- Generation-bound completion control file.
- Exact child id, activity sequence, and turn binding.
- Waiting-turn outcome and content-bearing evidence.
- Child-side recheck immediately before completion.
- Descendant-empty requirement with fail-closed registry handling.
- Atomic normal completion sidecar publication.
- Idempotence and stale-generation rejection.
- Focused race/stress tests.
- Documentation distinguishing completion from Escape.

#### Exclude

- Waiting timeout notifications.
- Snooze tool.
- Planner defaults.
- Usage telemetry.

#### Likely source references

- `interrupt-control.ts`
- Manual-completion portions of `50fecbd`
- Resume watcher correction from `37a5e54`

#### Acceptance criteria

- Safely waiting content-bearing completed turns close through normal completion and deliver the final answer.
- Active/blocked children receive Escape only when appropriate.
- Aborted, errored, partial, stale, unknown, or descendant-blocked generations cannot complete.
- Repeated completion requests for one generation are idempotent.
- `finish: false` always means turn-level Escape behavior.

---

### PR 6 — Waiting timeout notifications and one-shot snooze

#### User-visible promise

Interactive children can notify their parent when a turn is ready without being interrupted or closed.

#### Include

- `wait-timeout` profile frontmatter.
- Per-spawn `waitTimeout` override.
- `wait-timeout-message` / `waitTimeoutMessage`.
- Disabled, immediate, and bounded-seconds semantics.
- Generation-bound one-shot notification state.
- Strict message character/byte caps.
- `subagent_snooze` replacement/cancel behavior.
- Planner default and planning-skill guidance.
- Waiting policy fields in resume profiles.
- Unit and stress tests.

#### Exclude

- Usage/cost telemetry.
- Tool-policy telemetry.

#### Likely source references

- `waiting-timeout.ts`
- Waiting/snooze portions of `50fecbd`
- `agents/planner.md`
- `plan-skill.md`

#### Acceptance criteria

- A waiting generation produces at most one initial notification.
- Failed delivery is retryable until acknowledged.
- New activity invalidates old state.
- Snooze replaces the current generation's pending reminder and fires at most once.
- Snooze never interrupts or completes the child.
- Timeout settings survive a policy-preserving resume.

---

### PR 7 — Telemetry, deferred pending design review

Do not prepare this PR until telemetry requirements are settled.

Potentially split it into two PRs:

1. **Active tool-policy evidence** — expected/actual tools, deny drift, mismatch reporting.
2. **Usage accounting** — cumulative sessions, turns, responses, tokens, cost, and per-model buckets.

These solve different problems and have different privacy, compatibility, and API concerns. They should not be bundled only because both currently use activity snapshots.

Likely source references:

- `7aeb8aa`
- `bca9903`
- Telemetry portions of `a1d9512`, `50fecbd`, `activity.ts`, and `launch-profile.ts`

## Dependency graph

```text
PR 1  Named-agent policy
  └── PR 4  Policy-preserving resume

PR 2  Explicit extension runtime
  └── PR 4  Policy-preserving resume

PR 3  Recursive descendant lifecycle
  ├── PR 4  Policy-preserving resume
  └── PR 5  Safe parent-driven completion
       └── PR 6  Waiting timeout and snooze

PR 7  Telemetry — deferred
```

PRs 1–3 can be developed and reviewed with minimal coupling. PRs 4–6 are naturally stacked.

## Internal fork review workflow

### Branch layout

Create clean branches from upstream, not from the current feature branch history:

```text
upstream/main
└── review/01-agent-policy
    └── review/02-explicit-extensions
        └── review/03-recursive-lifecycle
            └── review/04-resume-profiles
                └── review/05-safe-completion
                    └── review/06-waiting-timeouts
```

Push these branches to `origin` and open PRs in the `squiddity` fork with stacked bases:

| Head branch | Internal PR base |
|---|---|
| `review/01-agent-policy` | `main` or a fork branch pinned to `upstream/main` |
| `review/02-explicit-extensions` | `review/01-agent-policy` |
| `review/03-recursive-lifecycle` | `review/02-explicit-extensions` |
| `review/04-resume-profiles` | `review/03-recursive-lifecycle` |
| `review/05-safe-completion` | `review/04-resume-profiles` |
| `review/06-waiting-timeouts` | `review/05-safe-completion` |

A safer alternative to resetting fork `main` is to create an explicit base branch:

```bash
cd /home/squiddity/projects/pi-herdr-subagents
git fetch upstream origin
git switch -c review/upstream-base upstream/main
git push -u origin review/upstream-base
```

Then base `review/01-agent-policy` on `review/upstream-base`. This avoids disturbing fork `main` while internal review is underway.

### Reconstruction guidance

For each PR:

1. Start from the previous clean review branch.
2. Inspect the final feature branch for the desired behavior.
3. Use old commits only as navigation aids.
4. Reimplement or selectively apply the final relevant hunks.
5. Exclude later-feature fields and telemetry.
6. Add focused tests and docs in the same PR.
7. Run the narrow test first, then the complete project test/lint commands.
8. Keep the branch green before starting the next one.

Useful comparison commands:

```bash
git diff upstream/main...feat/explicit-extension-mode -- <paths>
git show <reference-commit> -- <paths>
git range-diff upstream/main...review/<previous> upstream/main...review/<current>
```

Avoid broad `git cherry-pick` for the profile and manual-completion commits. They contain superseded or cross-cutting code.

### Internal PR review checklist

Every internal PR should answer:

- What single user-visible problem does this solve?
- What behavior is intentionally unchanged?
- What is explicitly deferred?
- Does it introduce dormant fields or APIs?
- Does every failure occur before pane/process side effects when possible?
- Are Pi and Claude backend differences explicit?
- Are reload, shutdown, resume, and recursive behavior tested where relevant?
- Is the README wording proportional to the actual guarantee?
- Does the PR pass independently against its declared base?

## Moving approved work upstream

There is no need to clone another repository solely to open upstream PRs. Branches pushed to the fork can be used as heads for PRs into `0xRichardH/pi-herdr-subagents`.

Two transfer strategies are valid.

### Strategy A — Reuse/rebase the reviewed branches

Use this when the internal review branches are already clean and based on current `upstream/main`.

1. Fetch upstream.
2. Rebase the first branch onto the latest upstream base.
3. Rebase each later branch with `--onto` so the stack remains linear.
4. Force-push with `--force-with-lease` to the fork.
5. Re-run tests for every branch.
6. Open upstream PRs from the same fork branches, gradually.

This preserves reviewed commits but stacked rebases require careful bookkeeping.

### Strategy B — Create fresh upstream-facing branches and cherry-pick reviewed commits

This is the recommended default, especially if each internal PR is squashed to one coherent commit.

```bash
git fetch upstream origin

git switch -c upstream-pr/01-agent-policy upstream/main
git cherry-pick <approved-pr-1-commit>

git switch -c upstream-pr/02-explicit-extensions upstream-pr/01-agent-policy
git cherry-pick <approved-pr-2-commit>

# Continue in dependency order.
```

Then push each `upstream-pr/*` branch to the fork and open upstream PRs with the appropriate stacked base.

Benefits:

- Internal review history remains separate.
- Upstream branches contain only approved commits.
- It is easy to rerun tests after each cherry-pick.
- Accidental merge commits or review-only fixups do not leak upstream.

## Upstream submission recommendation

1. Synchronize with the latest `upstream/main` before reconstruction and again before submission.
2. Review the full stack internally first.
3. Prefer one coherent commit per approved PR, unless a PR genuinely benefits from two independently reviewable commits.
4. Open upstream PRs gradually rather than all at once.
5. Start with PR 1 or PR 2, whichever upstream is most likely to accept independently.
6. Wait for maintainer feedback before publishing dependent PRs broadly; early feedback may change API naming or scope.
7. Clearly label stacked PR dependencies and show only the incremental diff.
8. Include migration/breaking behavior notes in PR 4, especially the required-profile resume change.
9. Do not claim unsigned profiles establish provenance or tamper resistance.
10. Keep telemetry out until its separate design review is complete.

## Suggested PR template sections

Use a compact structure for each upstream PR:

```markdown
## Problem

## User-visible behavior

## Design

## Intentionally unchanged / deferred

## Compatibility and backend differences

## Tests

## Stack dependency
```

For PR 4, include an explicit compatibility section:

```markdown
`subagent_resume` now accepts only sessions created with a preserved launch profile.
External or older sessions remain resumable with `pi --session`, but do not receive
tracked policy-preserving resume behavior.
```

## Alternative if upstream prefers fewer PRs

If maintainers reject a long stack, collapse it into four thematic PRs:

1. **Recursive execution policy** — unknown-agent failure, child-profile policy, explicit extensions.
2. **Recursive lifecycle and policy-preserving resume** — descendants, deferred auto-exit, required unsigned profiles.
3. **Safe completion and waiting notifications** — completion-aware interrupt, timeout, snooze, planner behavior.
4. **Telemetry** — still deferred pending design review.

The seven-PR plan is preferred because it reduces review surface and allows upstream to accept useful subsets.

## Validation baseline

At commit `ea7e784`, before reconstructing this stack:

- Full test suite: 234 passing.
- Lint: zero warnings and zero errors.
- Independent review of the unsigned profile/resume simplification found no concrete issues.

Each reconstructed PR must establish its own green baseline. Do not rely on the final feature branch's test result as proof that an intermediate branch is correct.

## Next-session starting checklist

1. Read this document completely.
2. Inspect current upstream history and open PRs before choosing names/APIs.
3. Fetch `upstream` and verify the new merge base.
4. Confirm whether telemetry is still deferred.
5. Create `review/upstream-base` from `upstream/main`.
6. Review the completed PR6 branch and its stacked diff (`review/06-waiting-timeouts`).
7. Run focused and full validation for any review fixes.
8. Keep PR7 telemetry deferred until its design review is complete.
9. Do not begin upstream submission until the internal stack and compatibility notes are reviewed.
