---
status: planned
depends: [device-backup-orphans]
specs:
  - specs/commands/device.md
  - specs/behaviors/device-access.md
  - specs/skill.md
issues: [21]
---

# Device reattach and playbook absorption

## Scope

The one writing command: `device reattach <path> --map … | --restore-index`,
under the full write ritual (embedded backup, stop xochitl, write, sync,
restart). With every device command then shipped, this plan also **absorbs the
command surface into the skill's playbook** — `references/ink-recovery.md` swaps
its raw SSH fragments for `device` invocations, keeping the manual steps as a
fallback appendix.

Also in scope, as an investigation item: measure whether device-side
pending-sync state is reliably detectable — the open question gating
[the blind-spot-free replace gate](../specs/behaviors/device-access.md#the-prize-closing-the-blind-spot-at-the-gate)
— and record findings in the spec or a follow-up issue. Implementing that gate is
out of scope.

## Implements

- `specs/commands/device.md` — `device reattach`, `BACKUP_FAILED`, the
  restore-index `HAS_INK` refusal
- `specs/behaviors/device-access.md` — the write ritual
- `specs/skill.md` — the absorption stage ("the skill describes the shipped
  surface")

## Approach

- Ritual as a single guarded code path: backup (reusing `device backup`; refuse
  on failure with nothing written), `systemctl stop xochitl`, apply, `sync`,
  restart, verify xochitl came back. Every step's outcome in the output.
- `--map`: copy each named orphan `.rm` to the target page uuid inside the doc
  dir. `--restore-index`: rewrite `.content`'s pages list to the orphaned uuids;
  refuse (`HAS_INK`) when any currently-indexed page carries strokes the restore
  would orphan.
- Per-stroke disposition table in the output; never a bare success.
- `reference.ts` + skill region regenerated; playbook absorption edits
  `references/ink-recovery.md`.
- Live-fire verification is gated and orchestrator-owned: a scratch document in
  `/AXI Verify` with a deliberately orphaned page, reattached and confirmed
  syncing — never a user document. If a safe live drill cannot be arranged, the
  live boxes stay unchecked with a runbook in Notes instead, per the
  parallel-execution protocol's operational-plan rule.
- While on-device with a scratch doc: run the pending-sync detectability
  measurement (issue #21's page-list question may also be measurable here —
  attempt it if the scratch setup allows, record findings either way).

## Validation

- [ ] Backup failure aborts before any write (`BACKUP_FAILED`)
- [ ] `--map` attaches named strokes; disposition table reports each
- [ ] `--restore-index` refuses when current pages carry ink
- [ ] xochitl stop/sync/restart sequence verified in the mocked exec layer's
      command log
- [ ] Live drill (orchestrator, scratch doc): orphan → reattach → ink visible on
      device and syncing up
- [ ] Pending-sync detectability measured and findings recorded
- [ ] `references/ink-recovery.md` cites `device` commands; manual steps demoted
      to fallback; skill drift CI green

## Risks / unknowns

- **Writes on a live filesystem** — the ritual exists because xochitl caches the
  index; any deviation risks the exact class of loss this exists to fix. The
  scratch-doc drill is the only live write ever performed by this plan.
- **Partial-restore demand** — the two specced modes cover both observed incident
  shapes; if a mixed case appears, spec first, then extend.

## Notes

(Populated at closeout.)

## Follow-ups

(Populated at closeout.)
