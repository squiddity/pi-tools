# Plan: package `pi-herdr-subagents` changes for upstream review

## Purpose

This document is a handoff for a fresh session. It captures how to split the current `pi-herdr-subagents` feature branch into small, useful pull requests, review those PRs in the `squiddity` fork first, and then reapply or rebase the approved work for the upstream repository.

Do **not** send upstream PRs merely because this document exists. The immediate next phase is reconstruction and internal review in the fork.

## Current internal review status

PRs 1–7 are pushed as one-commit review branches to the `squiddity` fork and are stacked on the updated `review/upstream-base` (`9a45fb9`, upstream v0.1.6). PR6 is at `67efebb` with draft PR #6. PR7 combines bounded tool-policy and usage telemetry at `038f482` on `origin/review/07-telemetry` with draft PR #7. No upstream PRs have been opened.

Exact reviewed stack state:

| Increment | Branch | Incremental commit range |
|---|---|---|
| Base | `review/upstream-base` | `9a45fb9` |
| PR1 | `review/01-agent-policy` | `9a45fb9..0de3b2c` |
| PR2 | `review/02-explicit-extensions` | `0de3b2c..784e616` |
| PR3 | `review/03-recursive-lifecycle` | `784e616..b383c1c` |
| PR4 | `review/04-resume-profiles` | `b383c1c..19494a3` |
| PR5 | `review/05-manual-completion` | `19494a3..e3fe4d0` |
| PR6 | `review/06-waiting-timeouts` (draft PR #6) | `e3fe4d0..67efebb` |
| PR7 | `review/07-telemetry` (draft PR #7) | `67efebb..038f482` |

The external checkout's local-only `integration/review-stack` pointer is at the current PR7 tip `038f482`.

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

Reference and review tips when this document was updated:

```text
upstream/main                    9a45fb9
review/upstream-base             9a45fb9
review/06-waiting-timeouts       67efebb
review/07-telemetry              038f482
integration/review-stack         038f482 (local terminal pointer)
feat/explicit-extension-mode     ea7e784
```

The reference feature branch was built as 17 commits over the former upstream base, with exact range `d654eae..ea7e784`. After upstream advanced to `9a45fb9`, treat it as a historical semantic reference rather than a branch directly ahead of current `upstream/main`. Its final diff is large:

```text
20 files changed, 4,783 insertions, 175 deletions
```

The feature branch is a **reference implementation**, not suitable as one upstream PR. Its history contains cross-cutting commits, fixups, a reverted commit, and one especially large commit that combines manual completion, waiting notifications, planner behavior, tests, and documentation. The review branches are reconstructions, not cherry-picks, so `git cherry` reports all 17 reference commits as unique even where PR1–6 already reproduce their behavior. Compare behavior and focused diffs; do not use patch identity as a coverage test.

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

### Reference branch versus reconstructed PR1–6

The following distinction is important for the next phase:

- `feat/explicit-extension-mode` contains all 17 original commits, including both telemetry families, the now-removed profile attestation design, the broad `50fecbd` implementation, and its later fixes.
- `review/01-agent-policy` through `review/06-waiting-timeouts` contain clean, independently reconstructed versions of the named-agent policy, explicit extension runtime, recursive lifecycle, unsigned required resume profiles, safe completion, and waiting timeout/snooze behavior. They intentionally contain **no** active-tool or usage telemetry.
- The semantics of `37a5e54` (independent resumed-session completion watcher) are already represented in the review stack even though the reference helper `prepareSubagentWatcher` is not copied verbatim.
- The final policy of `ea7e784` (bounded, unsigned, required profiles; no attestation or profile-less tracked fallback) is already represented by PR4 and extended by PR6's waiting fields. Do not create another branch merely to replay `ea7e784`.
- The reference-only telemetry is not represented: active-tool/deny evidence originates in selected portions of `a1d9512`, with child-policy result exposure in `465de36`; usage accounting is the contiguous reference range `5bce605..bca9903` (`7aeb8aa` and `bca9903`).
- PR4 now includes the reference branch's standalone Pi session seeding: the deterministic session path is initialized with a parentless header before child process launch, alongside the required resume profile.
- PR7 adds the bounded regular-file handling needed for its larger telemetry activity sidecar without introducing a separate security architecture.
- Other visible tree differences are mostly reconstruction, documentation, formatting, test organization (`interrupt-control.test.ts` versus `interrupt-stress.test.ts`), or superseded attestation code. They are not automatically missing features.

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
- Seed every initial Pi-backed standalone session at its deterministic path with a parentless session header before child process launch.
- Keep lineage-only and fork session seeding behavior unchanged.
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

- Every new Pi-backed tracked child gets a profile and an initialized deterministic session file.
- Standalone session headers contain the child cwd and no `parentSession`; lineage-only and fork modes retain their existing linkage behavior.
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

### PR 7 — Bounded tool-policy and usage telemetry

Branch and range:

```text
review/06-waiting-timeouts (67efebb)
└── review/07-telemetry (038f482)
    incremental range: 67efebb..038f482
```

Draft fork PR: <https://github.com/squiddity/pi-herdr-subagents/pull/7>

#### User-visible promise

Pi-backed child completions expose bounded observational tool-policy evidence and content-free provider usage accounting.

#### Include

- Capture active tools after startup and compare them, plus effective deny names, with the preserved launch profile.
- Report `toolProfile` as `exact`, `mismatch`, `unrestricted`, or `unverified`, including deny drift and active-denied evidence.
- Record tracked-run sessions, turns, assistant responses, provider-reported token categories, and provider-reported costs.
- Include structured `runningChildId` and session-file `sessionId` identifiers on initial and resumed completions, plus the reference host-identity presentation line.
- Include `launchProfilePath` and `allowedChildAgents` on initial completions, and `launchProfilePath` with `profileStatus: "preserved"` on resumed completions.
- Add at most 64 provider/model usage buckets; unavailable metrics remain `null` and are never estimated.
- Preserve cumulative totals when the same tracked activity sidecar is reopened, including child extension reload; a separate `subagent_resume` launch starts a new activity sidecar.
- Refresh the activity sidecar synchronously before completion details are built.
- Bound and validate activity sidecars and prove message content is not persisted.

#### Exclude

- Signatures, HMAC, attestation, provenance, or sandboxing.
- Correlation fields beyond the bounded reference completion identity and profile-policy fields.
- Billing claims, dashboards, budgets, quotas, or cross-child aggregation.
- Prompt, response, reasoning, credential, grant, or permission content.
- Unrelated reference-branch refactors.

#### Validation

- Focused telemetry tests: 18 passing.
- Full suite: 236 passing.
- Integration suite: 16 passing.
- Lint: clean.
- Waiting-timeout stress suite: 10 passing.
- `git diff --check`: clean.

### Residual reconciliation after PR7

Standalone session seeding is already owned by PR4. Run a final semantic comparison against `review/06-waiting-timeouts..feat/explicit-extension-mode` and classify remaining hunks as represented behavior, superseded attestation, test/docs organization, or intentional divergence.

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

PR 7  Bounded tool-policy and usage telemetry
```

PRs 1–3 were developed with minimal coupling. PRs 4–7 are naturally stacked.

## Internal fork review workflow

### Branch layout

Create clean branches from upstream, not from the current feature branch history:

```text
upstream/main
└── review/01-agent-policy
    └── review/02-explicit-extensions
        └── review/03-recursive-lifecycle
            └── review/04-resume-profiles
                └── review/05-manual-completion
                    └── review/06-waiting-timeouts
                        └── review/07-telemetry
```

Push these branches to `origin` and open PRs in the `squiddity` fork with stacked bases:

| Head branch | Internal PR base |
|---|---|
| `review/01-agent-policy` | `main` or a fork branch pinned to `upstream/main` |
| `review/02-explicit-extensions` | `review/01-agent-policy` |
| `review/03-recursive-lifecycle` | `review/02-explicit-extensions` |
| `review/04-resume-profiles` | `review/03-recursive-lifecycle` |
| `review/05-manual-completion` | `review/04-resume-profiles` |
| `review/06-waiting-timeouts` | `review/05-manual-completion` |
| `review/07-telemetry` | `review/06-waiting-timeouts` |

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
5. For PR1–6, exclude later-feature fields and telemetry; for PR7, include only the telemetry declared by its increment.
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

### Validation gates for PR7

PR7 must cover active-tool timing, tool/deny comparison states, usage and cost accounting, null metrics, tracked-sidecar continuation, final refresh, bounded/unsafe files, and content non-persistence. Run `npm test`, `npm run lint`, `npm run test:stress`, and `git diff --check`; inspect the incremental diff to ensure deferred attestation, identity, and aggregation work did not leak in.

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

## Terminal local integration-testing stack point

After PR1–7 are reviewed, move the existing **local-only** integration pointer:

```bash
cd /home/squiddity/projects/pi-herdr-subagents
git switch integration/review-stack
git reset --hard <final-reviewed-tip>
```

Run this only from a clean checkout. `<final-reviewed-tip>` is `review/07-telemetry`.

The complete tested range is:

```text
review/upstream-base..integration/review-stack
# currently anchored at upstream v0.1.6 (9a45fb9) on the base side
```

Rules for this branch:

- It contains no integration-only product changes and no merge commits; it is a movable pointer to the exact reviewed linear stack.
- Record the resolved tip SHA, base SHA, Node/npm versions, test commands, and results in the internal review notes.
- Keep it local by default. Do not push it, name it `upstream-pr/*`, open a PR from it, or treat its existence as approval to submit upstream.
- If integration testing finds a defect, fix it on the owning `review/*` branch, rebase descendants, and move/recreate the integration pointer. Never patch only the integration branch.
- Test recursive spawn, explicit extension inheritance, descendant delivery/auto-exit, profile-preserving resume including PR4 standalone seeding, safe completion, timeout/snooze, both telemetry schemas, and reload/shutdown as one end-to-end stack.
- Rebuild it from a refreshed upstream base before any later submission phase; that is a separate decision and validation event.

This branch is the terminal artifact for the current local review phase. It deliberately does not imply immediate upstream submission.

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
10. Keep PR7 upstream-ineligible until its internal review is complete; local integration testing does not constitute submission approval.

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
4. **Telemetry** — bounded tool-policy and usage evidence from PR7.

The fine-grained plan is preferred because it reduces review surface and allows upstream to accept useful subsets. Standalone session seeding is part of PR4's resume-profile contract.

## Validation baseline

At reference commit `ea7e784`, before reconstruction began:

- Full test suite: 234 passing.
- Lint: zero warnings and zero errors.
- Independent review of the unsigned profile/resume simplification found no concrete issues.

PR7's current review tip is `038f482`; its incremental range is `67efebb..038f482`. The stack tip passed 236 tests, lint, 10 waiting-timeout stress tests, and 16 Herdr integration tests. Treat validation as evidence only for these exact tips; do not rely on the reference branch's result as proof that a reconstructed branch is correct.

## Next-session starting checklist

1. Read this document completely.
2. Inspect current upstream history and open PRs before changing the pinned base or APIs.
3. Confirm `review/upstream-base` and `upstream/main` remain aligned at `9a45fb9` after the approved v0.1.6 rebase.
4. Reconfirm PR1–7 tips and review PR7's exact incremental diff `67efebb..038f482`.
5. Perform the final semantic diff classification against `ea7e784`.
6. Run local end-to-end integration testing from `integration/review-stack`.
7. Do not create `upstream-pr/*`, push the integration pointer, or open upstream PRs until a later explicit submission decision.
