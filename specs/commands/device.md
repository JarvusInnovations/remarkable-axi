# Command group: device

## Usage

```
device status  [--ssh <dest>] [--via <jump>]
device backup  <path> [--out <tar>] [--force] [--ssh <dest>] [--via <jump>]
device orphans [<path>] [--render] [--out <dir>] [--ssh <dest>] [--via <jump>]
device reattach <path> --map <stroke-uuid>=<page-uuid>[,...] | --restore-index
```

Work directly with the tablet's own storage over SSH — the state the cloud cannot
see. Connectivity, storage layout, and the write ritual are defined in
[device-access](../behaviors/device-access.md); this spec is the command surface
over them.

`<path>` is a cloud-style document path, resolved **on the device** by searching
`.metadata` visible names — these commands work even when the cloud has never heard
of the document (or has trashed it). Ambiguity refuses with the colliding uuids,
same as everywhere else.

## device status

Reachability and the device-side facts worth one connection: xochitl running and
its version, storage free, document count, and the configured destination (with
`via` when set). Instant answer to "can recovery tooling reach the tablet right
now" — run it *before* an incident, not during one.

```
device: reachable via mbp-2024
destination: root@192.168.1.37
xochitl: running, 3.22.0.65
storage: 4.1GB free of 58GB
documents: 691 local
```

## device backup

Tar a document's complete file set — `.metadata`, `.content`, strokes, thumbnails —
off the device to a local archive (default: `./<name>-device-backup-<date>.tar.gz`).
The first step of every recovery, and the primitive a scheduled ink snapshot builds
on. Read-only on the device.

```
backup:
  path: /Daily/Today
  uuid: 3f9a2c…
  archive: ./Today-device-backup-2026-08-17.tar.gz
  size: 1.2MB
  pages: 4 indexed, 5 stroke files (1 orphaned)
```

A stroke-file count exceeding the indexed page count is surfaced here — backup is
where orphans are usually first noticed.

`--force` overwrites an existing archive at the destination, matching
[get](get.md)'s own `--force` — the default refuses (`EXISTS`) rather than
silently clobbering a prior backup.

## device orphans

List stroke files no page index references: `.rm` files in a document's directory
whose page uuid is absent from that document's `.content` pages list. With no
`<path>`, sweep every document. Grouped per document; each orphan reports its
uuid, size, modified time, and whether an identifying thumbnail survives.

```
orphans[2]{doc,stroke,size,modified,thumbnail}:
  /Daily/Today,8c1d44…,26KB,2026-08-17 10:37,yes
  "/APTAtech 2026/Leads",e02a91…,31KB,2026-08-14 08:35,yes
help[2]:
  Run `remarkable-axi device orphans "/Daily/Today" --render` to see what each orphan holds
  Run `remarkable-axi device backup "/Daily/Today"` before any reattach
```

`--render` composites each orphan to a page image — the same `.rm` parsing pipeline
`get --as svg` uses and the same preview scale `check` writes — alongside its
surviving thumbnail, so identification is an eye-pass, not uuid archaeology. An
account with no orphans says so explicitly.

Zero-stroke `.rm` files (created by merely opening a page) are reported as a count,
not as orphans — they hold nothing recoverable and listing them as losses teaches
the reader to ignore the table.

## device reattach

Write recovered strokes back into a live document's index — the one writing command,
governed in full by the [write ritual](../behaviors/device-access.md#reads-are-free-writes-follow-the-ritual):
automatic backup first (refuse if it fails), stop xochitl, write, sync, restart.

Two modes, matching the two incident shapes:

- `--map <stroke-uuid>=<page-uuid>[,...]` — attach named orphans to named pages of
  the current index: each stroke file is copied to the target page's uuid. The
  known-page case.
- `--restore-index` — rewrite `.content`'s pages list back to the orphaned page
  uuids, restoring the pre-clobber index wholesale. The everything-was-replaced
  case. Refuses when the document's current index carries any inked page that the
  restore would in turn orphan — it never trades new ink for old.

```
reattached:
  path: /Daily/Today
  backup: ./Today-device-backup-2026-08-17.tar.gz
  mode: map
  strokes[1]{stroke,page,disposition}:
    8c1d44…,a91f03…,attached
  xochitl: restarted
help[1]: Reopen the document on the tablet — the ink is live and will sync up on its own
```

Choosing *which* mode, and which mapping, is judgment — the thumbnail eye-pass, the
incident timeline — and belongs to the operator and the companion skill, not to a
heuristic in this command. `reattach` executes an explicit instruction; it never
guesses a mapping.

## Failure

| Condition | Code |
| --- | --- |
| no destination configured and no `--ssh` | `NO_DEVICE_SSH`, naming `setup ssh` |
| ssh binary not found | `MISSING_TOOL`, naming what to install and that `doctor` checks it |
| destination unreachable / auth failed | `DEVICE_UNREACHABLE`, with the key-install steps on auth failure |
| `<path>` matches nothing on the device | `NOT_FOUND` |
| `<path>` matches several documents | `AMBIGUOUS`, listing uuids |
| `backup`'s archive destination exists | `EXISTS` unless `--force` |
| `reattach` backup step failed | `BACKUP_FAILED` — nothing written |
| `--restore-index` would orphan current ink | `HAS_INK`, naming the inked pages |

## Relationship to the rest of the surface

- [ink-preservation](../behaviors/ink-preservation.md) defines the blind spot that
  makes this group necessary; its recovery pointer lands here.
- `doctor` gains a device block when a destination is configured: reachability and
  the account-wide orphan count.
- [get](get.md)'s `.rm` rendering pipeline is what `orphans --render` reuses — one
  stroke parser, both directions.
- The **companion skill** shipped from this repo carries the judgment half:
  incident triage (lost vs merely unsynced), the freeze-the-device discipline
  (Wi-Fi off, stop opening documents — orphans are unreferenced and continued use
  reclaims them), mode choice, and post-recovery verification. Commands here stay
  deterministic; the skill sequences them.
- Live device access is also what [issue #21](https://github.com/JarvusInnovations/remarkable-axi/issues/21)
  (`--keep-ink`) has been waiting on: the page-list question it needs answered is a
  measurement this access path can finally make.

## Principles

**Inherited** — project principles that especially bite here:

- [The device is read-only until a backup exists](../behaviors/device-access.md#principles)
  — `reattach` embeds its own backup; there is no flag to skip it.
- [Never manufacture a state the tool refuses to operate on](../principles.md#never-manufacture-a-state-the-tool-refuses-to-operate-on)
  — `--restore-index` refusing to orphan current ink is this rule on the device side.
- [Best-effort operations report per-item outcomes](../principles.md#best-effort-operations-report-per-item-outcomes)
  — reattach reports per-stroke dispositions, never a bare success.
