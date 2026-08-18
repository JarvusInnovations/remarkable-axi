---
status: done
depends: []
specs:
  - specs/behaviors/device-access.md
  - specs/commands/device.md
issues: []
pr: 40
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

- [x] `setup ssh root@<ip>` persists and `device status` uses it; `--ssh`
      overrides it per invocation
- [x] `--via <jump>` produces a ProxyJump invocation; omitted produces direct
- [x] No destination configured → `NO_DEVICE_SSH` naming `setup ssh`
- [x] ssh binary absent → `MISSING_TOOL`; `doctor` reports ssh alongside
      chrome/ghostscript
- [x] Auth failure → `DEVICE_UNREACHABLE` with key-install steps; no password
      prompt ever occurs (BatchMode)
- [ ] Live (orchestrator, read-only): `device status` against the real tablet via
      the relay returns the spec's fields

## Risks / unknowns

- **BusyBox drift** — remote command syntax is only proven on the firmware at
  hand; the exec layer centralizes remote commands so a firmware quirk is fixed
  in one place.

## Notes

- Implemented as PR [#40](https://github.com/JarvusInnovations/remarkable-axi/pull/40):
  `src/device.ts` (the exec layer — ssh discovery, target resolution,
  `execRemote` with an injectable runner, BusyBox-safe status command/parser),
  `src/commands/device.ts` (`setupSsh`, `device`/`status`), `setup ssh` wired
  into `setup`'s dispatch, `doctor`'s `ssh` field and resilient device block,
  and the `ssh` config block in `src/config.ts`.
- All five non-live validation boxes are checked, backed by 47 new unit tests
  across four files (`test/device.test.ts`, `test/commands/device.test.ts`,
  `test/commands/doctor-device.test.ts`, `test/config.test.ts`). `execRemote`
  takes an injectable runner precisely so these tests — and every later
  `device` command's tests — never open a real connection.
- **The live-device validation box is intentionally left unchecked.** Per the
  orchestration protocol, live verification against the real tablet (via the
  relay) is the orchestrator's gate, run read-only after merge — not
  something this implementation pass performs. `bun run check`, `bun run
  test`, and `bun run build` all ran clean; the only test failures observed
  across two full suite runs were the two pre-existing, already-documented
  `"no device target … NO_DEVICE"` failures in `check`/`render` (issue #34),
  unrelated to and unmodified by this change.
- While implementing, found and fixed a latent bug in `config.ts`'s
  `readConfig`: the pre-existing implementation returned `{}` outright
  whenever `targetDevice` was absent, which would have silently discarded a
  valid `ssh` block too. Config fields are now validated and defaulted
  independently (`readSshConfig`, exported for direct unit testing with no
  file I/O).
- `STATUS_COMMAND`'s exact remote shell (systemctl for xochitl state,
  sourcing `/usr/share/remarkable/update.conf` for the version, `df -k` for
  storage) is unverified against real firmware — flagged in this plan's
  "BusyBox drift" risk and worth double-checking during the orchestrator's
  live verification pass, since a parse miss degrades a field to "unknown"
  rather than failing the command.

## Follow-ups

- If the live verification pass finds `STATUS_COMMAND` doesn't match real
  firmware (wrong path, unsupported BusyBox flag, xochitl not under
  `systemctl`), fix it in `src/device.ts` — it's the one place every
  `device` command's remote commands live, per this plan's risk note.
- `device backup`, `device orphans`, `device reattach` continue in
  [`device-backup-orphans`](device-backup-orphans.md) and
  [`device-reattach`](device-reattach.md), both of which depend on this plan.
