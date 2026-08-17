---
status: in-progress
depends: [device-reattach]
specs:
  - specs/behaviors/device-access.md
  - specs/commands/device.md
issues: [21]
---

# Live hardening: first contact with real hardware

## Scope

The fixes and verifications from the first live contact between the `device`
group and a real tablet (Paper Pro, firmware 3.28.0.169), which the build-out
plans deferred to the orchestrator gate:

1. Defects found on first contact, fixed here: unknown host key under BatchMode
   was a mute `DEVICE_UNREACHABLE` (now `accept-new`, with a loud, named
   changed-key refusal); every non-zero remote exit was classified unreachable
   (now only ssh's own 255 is; other exits are `REMOTE_FAILED` with stderr);
   `STATUS_COMMAND`'s unguarded `.` of `update.conf` aborted the shell on
   firmware without that file (now guarded, with an `/etc/os-release`
   `IMG_VERSION` fallback — verified live).
2. The live checks the frozen plans left unchecked: status, backup, orphan
   sweep, and the scratch-document reattach drill.
3. The pending-sync detectability measurement (issue #21's page-list question
   attempted alongside if the scratch setup allows).

## Implements

- `specs/behaviors/device-access.md` — "First contact trusts, changed keys
  refuse" (added here)
- `specs/commands/device.md` — the `REMOTE_FAILED` failure row (added here)

## Approach

Fixes first (this PR), then the live sequence with the fixed build:
`device status` → `device orphans` sweep → `device backup` of a real document →
drill: `put` a scratch PDF to `/AXI Verify`, plant a valid `.rm` under an
unindexed uuid in its on-device dir, confirm `orphans` reports it, `reattach
--map` it onto the scratch page, verify ink lands and syncs — never touching a
user document. Pending-sync probing is read-only and time-boxed.

## Validation

- [ ] `STATUS_COMMAND` runs clean on firmware 3.28 (no update.conf) and reports
      the IMG_VERSION
- [ ] Non-255 remote exits surface as `REMOTE_FAILED` with stderr; 255 stays
      `DEVICE_UNREACHABLE`; changed-key refusal names the changed key
- [ ] Live: `device status` returns the spec's fields against the real tablet
- [ ] Live: `device orphans` sweeps the real account; zero-stroke files
      reported as counts
- [ ] Live: `device backup` archives a real document; archive verified locally
- [ ] Live drill: planted orphan detected, reattached via `--map`, ink visible
      and syncing; no user document touched
- [ ] Pending-sync detectability measured and findings recorded

## Risks / unknowns

- **The drill writes to a live tablet** — scratch document only, ritual code
  path only, backup-first enforced by the command itself.

## Notes

(Populated at closeout.)

## Follow-ups

(Populated at closeout.)
