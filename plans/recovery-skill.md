---
status: done
pr: 39
depends: []
specs:
  - specs/skill.md
issues: []
---

# The companion skill, playbook-first

## Scope

Create the repo's one installable skill per [specs/skill.md](../specs/skill.md):
lean lavish-register `SKILL.md` with a generated command-reference region, plus
`references/ink-recovery.md` (the incident playbook) and
`references/ssh-setup.md` (the one-time device-SSH walkthrough). The playbook
ships the **manual SSH procedure** — the `device` commands do not exist yet, and
the published skill describes the shipped surface only.

Out of scope: absorbing the `device` commands into the playbook (deferred to
[`device-reattach`](device-reattach.md), which lands the last of them); any change
to CLI behavior.

## Implements

- `specs/skill.md` — the whole spec at its manual-procedure stage

## Approach

- Scaffold per the axi-skills recipe: `skills/remarkable-axi/SKILL.md` +
  `references/`, installable via `npx skills add`, documented in the README as the
  hook's complementary discovery path.
- Generate the command-reference region from `reference.ts` at build time with a
  `--check` CI step that fails when the committed skill is stale — this is the
  hook that forces later plans to regenerate when they add commands.
- SKILL.md: orientation, the design-loop and send/pull workflows in brief, every
  example as `npx -y remarkable-axi …`, one-line when-to-open cue per reference
  file. Target lavish's size class, not specops'.
- `references/ink-recovery.md`: triage (orphaned vs merely-unsynced vs
  trashed-but-local), hands-off discipline, tar-first backup, thumbnail
  identification, reattach-by-uuid and index-restore as raw BusyBox-safe SSH
  steps, verification. Source material: the two incident procedures (sessions
  41e13c90, a31fc74e).
- `references/ssh-setup.md`: enable SSH on-device, key install, password-rotation
  note, direct vs relayed destination.
- Description written trigger-shaped (symptoms included: lost/missing
  handwriting, blank pages that were written on) and run through the
  skill-creator description-optimization loop against should/should-not-trigger
  cases.

## Validation

- [ ] `npx skills add` from the repo installs the skill with SKILL.md and both
      reference files — structure matches the axi-skills recipe (`skills/<name>/`
      + `references/`) but a live `npx skills add` against the pushed branch was
      not exercised; see Notes
- [x] CI fails when SKILL.md's generated region is stale against `reference.ts`
      — verified directly: staled one line of the generated region, ran
      `bun run check:skill`, confirmed exit 1 with the stale-region message,
      restored, confirmed exit 0 clean; the same script is now wired into
      `.github/workflows/ci.yml`
- [x] The playbook contains no reference to any unshipped command — the one
      mention of `remarkable-axi device` in ink-recovery.md explicitly says
      those commands don't exist yet; no invocation example uses them
- [x] Every command example in the skill runs via `npx -y remarkable-axi` without
      a global install — grepped every example across SKILL.md and both
      reference files
- [ ] Description optimization run; final description beats the draft on the
      held-out trigger set — see Notes

## Risks / unknowns

- **Playbook fidelity** — the manual steps are transcribed from two real
  incidents on one device model/firmware; BusyBox and path details may drift with
  firmware. The playbook states its provenance and firmware so a mismatch reads
  as staleness, not user error.

## Notes

- **Skill is npm-published, not bundled.** `remarkable-axi` already ships to
  npm, so unlike the axi-skills recipe's default (a committed self-contained
  `.mjs` bundle under `scripts/`), this skill has no CLI to bundle — every
  example invokes the published package via `npx -y remarkable-axi …`, the
  same model the `lavish` skill uses. `src/skill.ts` + `scripts/build-skill.ts`
  still implement the recipe's marker-splice generation and `--check` drift
  gate for the command-reference region, just with a simpler artifact set.
- **Description-optimization attempt, and why the box is unchecked.** Ran
  skill-creator's `run_loop.py` (20 hand-written should/should-not-trigger
  queries, `--model claude-fable-5`, `--max-iterations 3`) against the draft
  description. Iteration 1 completed and measured **0% recall on both the
  original description and its own first proposed replacement** — including
  on unambiguous positive queries like "Send this PDF to my reMarkable
  tablet" — which reads as a harness/environment issue (nested `claude -p`
  skill-triggering not reliably observable under this sandbox) rather than a
  real description defect; a well-matched pushy description failing 0/3 on
  an unambiguous case isn't a plausible true negative. The run was killed
  before a completed, test-scored iteration existed, so there is no
  before/after score to report. The final description was hand-tightened
  afterward using the run's own iteration-1 proposal as a starting point
  (explicit inclusion list, an immediate-trigger clause for ink-loss
  symptoms, explicit do-not-use exclusions for adjacent devices/domains) —
  editorially reasonable, but not a scored best-of-N pick, so the Validation
  box stays unchecked rather than claiming a result that wasn't measured.
- **Tooling side effect, caught and cleaned up.** `run_eval.py` resolves its
  "project root" by walking up from cwd looking for a `.claude/` directory;
  invoked from `~/.claude/skills/skill-creator`, that walk lands on
  `~/.claude` itself, so its per-query command files landed in the **global**
  `~/.claude/commands/` (not a repo-local or worktree-scoped path) as
  `remarkable-axi-skill-<hash>.md`. Confirmed and swept twice — the second
  sweep after force-killing (`pkill -9`) the still-running optimizer, whose
  killed workers skipped their own cleanup `finally` block. Final state
  verified clean: `find ~/.claude/skills ~/.claude/commands /tmp -maxdepth 5
  -iname "*remarkable-axi-skill*"` returns zero hits. Nothing repo-local was
  touched by the leak; `skills/remarkable-axi/` in this worktree was never at
  risk.
- Full CI evidence, description text, and cleanup verification are in PR #39.

## Follow-ups

- Run `npx skills add JarvusInnovations/remarkable-axi --skill remarkable-axi`
  against the merged repo at least once to confirm the live install path
  actually works end to end (the first Validation box above) — not done in
  this plan since it needs the branch merged/pushed to a resolvable ref.
- Complete a real description-optimization pass once `run_loop.py` can be run
  to a finished, test-scored iteration in an environment where nested
  `claude -p` skill-triggering is reliably observable (or from a location
  whose `.claude/` walk doesn't resolve to the global config dir) — compare
  against the current hand-tightened description rather than assuming it's
  already optimal.
- [`device-reattach`](device-reattach.md) absorbs the `device` command group
  into `references/ink-recovery.md` once it ships, per this plan's declared
  out-of-scope boundary.
