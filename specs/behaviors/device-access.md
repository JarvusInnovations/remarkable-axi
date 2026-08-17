# Behavior: Device access

## Rule

The tool can reach the tablet itself over SSH — a second access path, beside the
cloud, for the state the cloud cannot see: unsynced ink, orphaned stroke files, the
on-device page index. Device access is **optional** (every cloud command works
without it), **read-only by default**, and **never writes without a same-invocation
backup**.

## Applies To

The `device` command group, `setup ssh`, `doctor`'s device block, and any future
command that touches on-device state. The blind spot it exists to cover is defined
in [ink-preservation](ink-preservation.md#cloud-checks-see-only-synced-ink).

## Details

### Connectivity: a destination, not a topology

The tablet exposes SSH on its WLAN address when enabled (Settings → Help → About).
Whether the machine running this tool can reach that address directly varies — a
laptop on the same Wi-Fi can; a remote devbox cannot and needs a relay through a
machine that can.

SSH arriving over WLAN means the device's Wi-Fi is necessarily on during
recovery — the same channel sync arrives on. The discipline that squares this is
**hands off the tablet**: from the moment loss is suspected until recovery
completes, nobody opens documents, writes, or launches the desktop app (a known
sync-cascade trigger). Orphaned strokes are unreferenced files — sync alone does
not reclaim them; *use* does — and the backup tar as recovery's first act bounds
the loss even if something does move.

The tool therefore takes an SSH **destination** and delegates topology to the
system's own `ssh`:

- `setup ssh <destination> [--via <jump>]` persists the default —
  `root@192.168.1.37`, or any `~/.ssh/config` host alias. `--via <jump>` persists a
  ProxyJump hop for when the tool's machine is not on the tablet's network; omit it
  when it is. Direct and relayed access are the same configuration with and without
  one field — never two modes.
- Every `device` command accepts `--ssh <destination>` (and `--via <jump>`) as a
  per-invocation override, because the tablet's DHCP address changes and a stale
  persisted IP must never strand a recovery.
- The tool shells out to the system `ssh` binary — discovered at run time and
  reported by `doctor`, exactly as Chrome and Ghostscript are. It never bundles a
  client, so everything `~/.ssh/config` can express (aliases, ProxyJump chains,
  IdentityFile) works without the tool knowing about it.

**First contact trusts, changed keys refuse.** The tool passes
`StrictHostKeyChecking=accept-new`: an unknown host key (a first connection, or a
re-flashed device) is recorded and trusted, because refusing it under
`BatchMode` yields only a mute failure no agent can act on — while a **changed**
key, the case that actually signals interception, still refuses loudly and the
error says the key changed rather than "unreachable". A remote command that runs
and fails is likewise distinguished from a connection that never succeeded: only
ssh's own transport failure reads as unreachable; the command's own non-zero exit
surfaces as what it is, with its stderr.

**Auth is key-based, full stop.** The tool never handles the device password — no
interactive prompts is AXI law, and a password inline in a command is worse. When
auth fails, the error explains the one-time manual step: read the password off the
device's About screen, `ssh-copy-id` (or the equivalent `authorized_keys` append)
from a machine that can reach it, and note that the factory password rotates when
`ssh over WLAN` is toggled — so posting it anywhere is recoverable.

### The device's shell is BusyBox

Remote commands must stay within BusyBox ash and BusyBox coreutils — `head -n N`
not `head -N`, no GNU extensions, no bash-isms. A command that works on the dev
machine and fails on the device is a bug in this tool, not the device.

### On-device storage layout

Everything lives under `/home/root/.local/share/remarkable/xochitl/`:

| Path | Holds |
| --- | --- |
| `<doc-uuid>.metadata` | visible name, parent (a folder uuid, `""` for root, `"trash"`) |
| `<doc-uuid>.content` | the **page index** — the ordered list of page uuids the document displays |
| `<doc-uuid>/<page-uuid>.rm` | one page's strokes |
| `<doc-uuid>.thumbnails/<page-uuid>.png` | ink-composited page render |

Two facts this layout implies, both load-bearing for recovery:

- **A stroke file exists independently of the index.** When a sync or replace
  rewrites `.content` with fresh page uuids, the old `.rm` files stay on disk,
  unreferenced — *orphaned, not destroyed*. xochitl does not eagerly reclaim them,
  but continued use of the device eventually will.
- **Thumbnails survive the clobber under the old page uuids**, so they identify
  what each orphaned stroke file holds — the map that turns a pile of uuids back
  into "page 7's margin notes".

A cloud-trashed document keeps its local directory and strokes until trash is
emptied on-device; `parent: "trash"` in `.metadata` is a place, not a deletion.

### Reads are free; writes follow the ritual

Read operations (status, backup, orphan listing, rendering) require nothing beyond
connectivity. Any operation that **writes** device state must:

1. Capture a backup of the affected document's full file set first, in the same
   invocation, and report where it landed — a write with no backup is refused, not
   attempted.
2. Stop `xochitl` before writing, `sync`, and restart it after — the running
   process caches the index and will overwrite edits made behind its back.
3. Report exactly what was written, so the transcript is the audit trail.

After a reattach, the device syncs the recovered strokes up itself — recovery
produces **live ink**, not a baked render.

### The prize: closing the blind spot at the gate

Cloud-side `HAS_INK` cannot see unsynced device ink
([ink-preservation](ink-preservation.md#cloud-checks-see-only-synced-ink)). A
configured device connection is the one place that check could become
blind-spot-free: before a replace, ask the *device* whether the target document's
local state carries strokes or pending changes the cloud hasn't seen.

**Status: desired, unverified.** Whether pending-sync state is reliably detectable
device-side has not been measured on hardware, and per
[Measure the device; never ship a guessed constant](../principles.md#measure-the-device-never-ship-a-guessed-constant)
this spec does not assert a mechanism. It records the intent: when a device
connection is configured, `put --replace` extends its ink check to the device; when
none is configured, the cloud-only check applies and says so.

## Principles

**Local** — principles owned by this behavior:

- **Optional means optional.** No cloud command may require device access, degrade
  without it beyond honestly stating what it could not see, or nag for it. The
  tool's core remains a cloud client that works with nothing but a pairing code.
- **The device is read-only until a backup exists.** Every write is preceded, in
  the same invocation, by a captured copy of what it touches. Recovery tooling that
  can worsen the incident it exists to fix is disqualified by construction.

**Inherited** — project principles that especially bite here:

- [Nothing the user made is destroyed without a findable copy](../principles.md#nothing-the-user-made-is-destroyed-without-a-findable-copy)
  — extended from the cloud's trash to on-device writes via the backup-first rule.
- [Measure the device; never ship a guessed constant](../principles.md#measure-the-device-never-ship-a-guessed-constant)
  — BusyBox quirks, storage layout, and any sync-state detection are measured
  against real hardware, and what could not be verified is labeled as such.
