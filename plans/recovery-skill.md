---
status: planned
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
      reference files
- [ ] CI fails when SKILL.md's generated region is stale against `reference.ts`
- [ ] The playbook contains no reference to any unshipped command
- [ ] Every command example in the skill runs via `npx -y remarkable-axi` without
      a global install
- [ ] Description optimization run; final description beats the draft on the
      held-out trigger set

## Risks / unknowns

- **Playbook fidelity** — the manual steps are transcribed from two real
  incidents on one device model/firmware; BusyBox and path details may drift with
  firmware. The playbook states its provenance and firmware so a mismatch reads
  as staleness, not user error.

## Notes

(Populated at closeout.)

## Follow-ups

(Populated at closeout.)
