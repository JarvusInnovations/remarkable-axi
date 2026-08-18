---
status: done
depends: [device-backup-orphans]
specs:
  - specs/commands/device.md
  - specs/behaviors/device-access.md
  - specs/skill.md
issues: [21]
pr: 42
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

- [x] Backup failure aborts before any write (`BACKUP_FAILED`)
- [x] `--map` attaches named strokes; disposition table reports each
- [x] `--restore-index` refuses when current pages carry ink
- [x] xochitl stop/sync/restart sequence verified in the mocked exec layer's
      command log
- [ ] Live drill (orchestrator, scratch doc): orphan → reattach → ink visible on
      device and syncing up
- [ ] Pending-sync detectability measured and findings recorded
- [x] `references/ink-recovery.md` cites `device` commands; manual steps demoted
      to fallback; skill drift CI green

## Risks / unknowns

- **Writes on a live filesystem** — the ritual exists because xochitl caches the
  index; any deviation risks the exact class of loss this exists to fix. The
  scratch-doc drill is the only live write ever performed by this plan.
- **Partial-restore demand** — the two specced modes cover both observed incident
  shapes; if a mixed case appears, spec first, then extend.

## Notes

- Implemented as PR [#42](https://github.com/JarvusInnovations/remarkable-axi/pull/42):
  `src/device.ts` (the ritual's fixed commands — stop/sync/start/is-active),
  `src/device-fs.ts` (the write-command builders — `buildMapApplyCommand`,
  `buildRestoreIndexCommand`, `restoreOrder`, `buildRestoredContent`),
  `src/commands/device.ts` (`reattach()`, plus a shared
  `defaultBackupPath`/`uniqueBackupPath`/`embeddedBackup` reused by both
  `reattach` and a refactored, behavior-preserving `backup`), and
  `src/reference.ts` (the command surface entry).
- **Validation ordering**, documented in `specs/commands/device.md`: every
  argument is checked against the *current* dump before either the backup
  or the write happens (cheap, local, no remote step). The embedded backup
  runs next. Only then, for `--restore-index`, does the `HAS_INK` gate run —
  after the backup (so a refusal still leaves an archive behind) but still
  strictly before xochitl is touched. The ritual's own steps (stop, apply,
  sync, restart, verify) always attempt the restart even when apply or sync
  failed, so a mid-ritual failure never leaves xochitl stopped.
- **Two new failure codes** beyond the spec's original three (`BACKUP_FAILED`,
  `HAS_INK`, plus the group's existing `NOT_FOUND`/`AMBIGUOUS`): `--map`
  argument validation and an empty `--restore-index` both reuse `NOT_FOUND`
  (a targeted message, not the path-resolution one); `REATTACH_FAILED` is new,
  for a failure after xochitl is already stopped — it names the backup
  already captured and reports honestly whether xochitl came back. Both are
  now in `specs/commands/device.md`'s Failure table.
- **The `.content` write**: base64-encoded locally, decoded on-device with
  `base64 -d` (the alphabet has no shell metacharacter, so it's safe inside
  single quotes regardless of the JSON's own contents), written to a `.new`
  sibling and `mv`'d into place so a decode failure never half-writes the
  live file. **Unverified against real hardware** — BusyBox has long shipped
  a `base64` applet, but this repo hasn't confirmed the on-device build
  enables it. Same discipline as `device-backup-orphans`' own `stat -c` risk
  note: worth checking in the orchestrator's live pass.
- **`--restore-index`'s page order**: ascending `.rm` mtime, unknown-mtime
  files last, uuid as a tiebreak. The document's own prior `.content` order
  is exactly what the clobber overwrote, so it isn't available to this pass;
  recovering it from an earlier `device backup` archive (when one exists) is
  left as a documented follow-up rather than built here.
- **`cPages.pages` synthesis**: the newer content shape needs synthesized
  `id`/`idx` entries for restored pages (they have no current entry to carry
  forward). `idx` is `[unknown]`/`[speculative]` even in `rmapi-js`'s own
  types; this pass invents a two-letter base-26 value in the observed shape
  rather than leaving the field absent (the type marks it non-optional).
  Also unverified against real hardware.
- **`reattach`'s embedded backup never collides with an earlier one**: no
  `--out`/`--force` of its own (per the spec's usage line), so a second
  same-day reattach gets a `-2`, `-3`, … suffix on the default archive name
  instead of either overwriting a prior backup or refusing `EXISTS`
  mid-ritual — both wrong for an automatic, safety-critical step.
- **Playbook absorption**: `skills/remarkable-axi/references/ink-recovery.md`
  now leads steps 1-5 with `device backup` / `device orphans` /
  `device orphans --render` / `device reattach` / `get --as svg`; the write
  ritual is no longer a manual step since `reattach` runs it end to end. The
  original manual SSH procedure is kept intact as a labeled fallback
  appendix. `SKILL.md`'s generated region picked up `device reattach`
  automatically; its Notes section no longer says the device group is
  undelivered. `bun run check:skill` is green.
- `bun run check`, `bun run build`, and `bun run check:skill` all ran clean.
  `bun run test` ran 525 tests; the only 2 failures were the pre-existing,
  already-documented `"no device target … NO_DEVICE"` failures in
  `check`/`render` (issue #34) — confirmed unrelated, since this PR never
  touches those files.
- **A pre-existing bug noticed but out of scope for this plan**: `device
  backup --help`, `device orphans --help`, and now `device reattach --help`
  all render `device status`'s help block, not their own. The SDK's
  `getCommandHelp` is called with only `argv[0]` (`"device"`), and
  `commandDoc()` matches the *first* entry whose usage starts with that
  word — so every multi-word command sharing a first word (also `setup
  device`/`setup hooks`/`setup ssh`) collides the same way. Predates this
  plan (confirmed by testing `device backup --help` against `develop` before
  any change here); worth its own fix, not folded into this one.
- **Per the parallel-execution protocol, live verification is
  orchestrator-owned and was not attempted here.** No real SSH connection or
  real tablet was touched at any point in this implementation pass — every
  test replaces both `execRemote` and `execRemoteBinary` with controllable
  stubs. The tablet is currently unreachable pending its LAN address.
- **The pending-sync detectability measurement (issue #21) also needs live
  hardware** and was not attempted for the same reason — it requires
  observing actual device-side sync state, which the mocked exec layer
  cannot produce meaningfully. Runbook for the orchestrator: once the
  tablet is reachable, write a stroke on a scratch document, immediately
  (before it syncs) probe the device over SSH for any observable
  pending-sync marker — check `.metadata`'s `lastModified`/`metadatamodified`
  fields, the presence of a `.cache`/lock file in the document's directory,
  or `xochitl`'s own logs (`journalctl -u xochitl` if available) — and
  record whether any of those reliably distinguishes "written, not yet
  synced" from "synced" without racing the sync itself. Record findings in
  `specs/behaviors/device-access.md`'s "The prize" section either way,
  per that section's own "Status: desired, unverified" framing.

## Follow-ups

- **Live drill** (orchestrator): a scratch document in `/AXI Verify` with a
  deliberately orphaned page, reattached via both `--map` and
  `--restore-index` in turn, confirming the ink appears on-device and syncs
  up — the two Validation boxes above stay unchecked until this runs.
- **Fix `device <sub> --help` routing** (noted above): a real, pre-existing
  bug affecting every multi-word command group (`device`, `setup`), not
  introduced by this plan. Worth its own small plan — likely a
  `getCommandHelp` change in `src/cli.ts` (or `commandDoc`) to consider the
  full `args` when resolving which sub-command's doc to render, not just
  `argv[0]`.
- **Recovering `--restore-index`'s page order from a prior `device backup`
  archive**, when one exists, instead of only the mtime fallback — deferred
  in this pass; see the Notes entry above.
- **`base64`/`cPages.idx` synthesis verification** against real firmware —
  flagged as unverified in both the code comments and this file; worth
  confirming in the same live pass as the drill above.
