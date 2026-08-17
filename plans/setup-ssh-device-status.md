---
status: planned
depends: []
specs:
  - specs/behaviors/device-access.md
  - specs/commands/device.md
issues: []
---

# SSH configuration and device status

## Scope

The connectivity foundation of the device group: `setup ssh <destination>
[--via <jump>]` persisting the device SSH config, per-invocation `--ssh`/`--via`
overrides, discovery of the system `ssh` binary (reported by `doctor`), the shared
device-exec layer every device command will use (BusyBox-safe command execution
with structured errors), and `device status`.

Out of scope: `backup`/`orphans`/`reattach`
([`device-backup-orphans`](device-backup-orphans.md),
[`device-reattach`](device-reattach.md)); any write to the device.

## Implements

- `specs/behaviors/device-access.md` — connectivity, auth posture, ssh discovery
- `specs/commands/device.md` — `device status`, the `NO_DEVICE_SSH` /
  `MISSING_TOOL` / `DEVICE_UNREACHABLE` failure rows

## Approach

- Config: `ssh` block (destination, optional `via`) in
  `~/.config/remarkable-axi/` beside the token and device target; `setup ssh`
  idempotent, re-runnable to repoint a drifted IP.
- Device exec layer: one module that builds `ssh [-J <via>] <dest> <cmd>`
  invocations with `BatchMode=yes` (no password prompts, per AXI), a connect
  timeout, and error translation — auth failure returns the key-install steps,
  unreachable names the destination it tried. Every remote command it accepts is
  written against BusyBox ash; the module doc-comments that constraint.
- `device status`: one connection gathering reachability, xochitl
  running/version, storage free, local document count; output per spec.
- `reference.ts`: Setup group gains `setup ssh`; new Device group with `status`
  (later plans append); regenerate the skill's command-reference region — the
  drift CI from [`recovery-skill`](recovery-skill.md) enforces this.
- Tests mock the exec boundary; no test opens a real connection.

## Validation

- [ ] `setup ssh root@<ip>` persists and `device status` uses it; `--ssh`
      overrides it per invocation
- [ ] `--via <jump>` produces a ProxyJump invocation; omitted produces direct
- [ ] No destination configured → `NO_DEVICE_SSH` naming `setup ssh`
- [ ] ssh binary absent → `MISSING_TOOL`; `doctor` reports ssh alongside
      chrome/ghostscript
- [ ] Auth failure → `DEVICE_UNREACHABLE` with key-install steps; no password
      prompt ever occurs (BatchMode)
- [ ] Live (orchestrator, read-only): `device status` against the real tablet via
      the relay returns the spec's fields

## Risks / unknowns

- **BusyBox drift** — remote command syntax is only proven on the firmware at
  hand; the exec layer centralizes remote commands so a firmware quirk is fixed
  in one place.

## Notes

(Populated at closeout.)

## Follow-ups

(Populated at closeout.)
