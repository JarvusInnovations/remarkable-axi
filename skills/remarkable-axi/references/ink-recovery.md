# Recovering lost or orphaned ink

**Provenance:** the manual SSH procedure below (now the fallback appendix)
worked twice on a reMarkable Paper Pro, firmware-current as of August 2026 —
a 12-page recovery and a 1-page recovery, both clean. The `device` commands
that now carry the primary path wrap that exact same sequence — same storage
layout, same backup-first-and-only-then-write discipline, same BusyBox
constraints — but have not yet been exercised against a real tablet
end-to-end; that live verification is tracked separately from this
playbook's own use. If a command's output doesn't match what's described
below, treat that as firmware or command drift, not user error, and go
carefully rather than assuming the doc is still right — the manual appendix
is always available as a check.

The mechanism: `remarkable-axi get` and `put --replace`'s ink check only see
**synced** ink. Strokes written on the device that haven't synced up yet are
invisible to every cloud call. A `put --replace`, or a stuck sync resolved by
a restart that took the cloud's side, can then win over those strokes — the
device rewrites its page index to the new document, and the unsynced strokes
become **orphaned**: unreferenced files still sitting on the device's disk,
not destroyed. xochitl (the device's document app) doesn't reclaim them
eagerly, but continued use of the tablet eventually will, so the exposure
window is real but bounded by how fast you act.

## Triage first

Before touching anything, work out which situation you're actually in —
the fix differs:

1. **Orphaned** (the case this doc is for) — the document shows fewer pages
   or less ink in the cloud than you remember writing, and a replace or a
   sync hiccup happened recently. The strokes are very likely still on the
   device, unreferenced. Continue below.
2. **Merely unsynced, not orphaned** — the device just hasn't pushed yet
   (Wi-Fi was off, sync stalled). Nothing has rewritten the index, so simply
   letting the device sync recovers it with zero SSH needed. Run
   `remarkable-axi device status` to confirm the tablet is reachable and
   give it time before assuming loss.
3. **Trashed but local** — the document was moved to the cloud's trash
   (`put --replace` does this to the superseded copy, renamed with a
   timestamp — see the main SKILL.md's `put --replace` note). Its local
   directory and strokes survive on-device until trash is emptied there,
   independent of cloud trash state. `.metadata`'s `parent: "trash"` is a
   place, not a deletion — `device backup`/`device orphans` resolve a
   trashed document's path under `/trash/...` and the reattach procedure
   below still applies to it.

Only case 1 (and stubborn cases of 3) need device access. Confirm you're in
one of those before proceeding — most "lost ink" reports turn out to be
case 2.

## The hands-off discipline — read before you touch anything

From the moment you suspect loss until recovery is verified complete:

- **Do not open the affected document, or any document, on the tablet.**
  Opening a page can trigger xochitl to touch its stroke files.
- **Do not write anything on the device.**
- **Do not launch the reMarkable desktop or mobile app.** Both are a known
  sync-cascade trigger — a full resync while an index is inconsistent is
  exactly what can finish reclaiming an orphaned stroke file.
- **Leave Wi-Fi on.** This feels backwards, but SSH arrives over the same
  Wi-Fi sync does — turning it off to "stop syncing" also cuts off the only
  way in to recover anything. The real safeguard isn't disconnecting; it's
  not *using* the device, and taking the backup below as the first act so
  the exposure window is bounded even if something does move.

## Set up device access

If you don't already have a working `ssh` to the tablet, stop here and work
through [ssh-setup.md](ssh-setup.md) first, then come back. Once `ssh
<destination>` reaches the device without a password prompt, persist it so
every `device` command below picks it up automatically:

```sh
npx -y remarkable-axi setup ssh <destination>
# relayed access (this machine isn't on the tablet's own Wi-Fi):
npx -y remarkable-axi setup ssh <destination> --via <jump-host>
```

Confirm it's working:

```sh
npx -y remarkable-axi device status
```

## Step 1 — back up everything, before any write

This is not optional and it comes before you've even confirmed exactly what
you're recovering:

```sh
npx -y remarkable-axi device backup "<path>"
```

`<path>` is the document's cloud-style path (`"/Daily/Today"`) — resolved
directly on the device by its visible name, so this works even when the
cloud has never heard of the document or has trashed it. The archive lands
at `./<name>-device-backup-<date>.tar.gz` by default; the command's own
output reports where and also flags a stroke-file excess over the indexed
page count, which is usually the first confirmation that orphans exist at
all.

## Step 2 — find the orphans

```sh
npx -y remarkable-axi device orphans "<path>"
```

Lists every `.rm` file the document's current page index doesn't reference,
with size, modified time, and whether a surviving thumbnail can identify it.
Omit `<path>` to sweep every document on the tablet, useful when you're not
yet sure which document lost ink. Pages that were merely opened and never
drawn on are reported as a count, not as rows — they hold nothing to
recover.

## Step 3 — identify each orphan by its thumbnail

```sh
npx -y remarkable-axi device orphans "<path>" --render
```

Composites each orphan's strokes to a preview image and pulls its surviving
thumbnail alongside it, into a directory the command reports. Look at both
for every orphaned uuid before deciding how to reattach — guessing which
stroke file goes where is exactly the mistake this step exists to prevent.

## Step 4 — reattach

```sh
npx -y remarkable-axi device reattach "<path>" --map <stroke-uuid>=<page-uuid>[,...]
# or, to restore the whole pre-clobber index at once:
npx -y remarkable-axi device reattach "<path>" --restore-index
```

Two shapes, pick the one that matches what step 3 showed you:

- **`--map`** — you know exactly which orphaned stroke file belongs on which
  page that's currently live in the document. Name one or more
  `<stroke-uuid>=<target-page-uuid>` pairs, comma-separated.
- **`--restore-index`** — the index was replaced wholesale (a full
  `put --replace` clobber) and the whole pre-clobber page list should come
  back at once. Refuses (`HAS_INK`) if any page currently in the index
  carries ink the restore would in turn orphan — it never trades new ink for
  old; use `--map` instead for a mixed case.

`reattach` runs the entire write ritual itself — embedded backup, stop
xochitl, write, `sync`, restart, and a restart check — as one command. There
is no separate manual step here: the command either reports success with a
per-stroke disposition table, or refuses before writing anything
(`BACKUP_FAILED`, `HAS_INK`, or a `NOT_FOUND` naming an invalid stroke/page
uuid).

## Step 5 — verify

`reattach`'s own output already confirms xochitl restarted. Beyond that:

1. Open the document **on the device** and confirm the ink is visible and on
   the right pages — this is the one point in the procedure where touching
   the tablet is correct, because the risky window has closed.
2. Confirm it syncs up: watch for the sync indicator, or re-check from the
   cloud side with `npx -y remarkable-axi get "<path>" --as svg` once you'd
   expect the sync to have completed. Recovery here produces **live ink,
   not a baked render** — the device pushes the recovered strokes up itself.

If the ink isn't there or isn't syncing, the archive `reattach` reported is
still your fallback — nothing about this procedure is destructive to it.

---

## Fallback: manual SSH procedure

Everything above wraps this exact sequence. Fall back to it by hand when a
`device` command itself is the thing misbehaving, when you need to inspect
or edit something the commands don't expose, or when this playbook is stale
relative to a firmware change the commands haven't caught up to yet.

Substitute your real destination everywhere `<destination>` appears below —
this doc uses a placeholder, never a real hostname or IP.

The device's shell is **BusyBox ash, not bash**: no GNU extensions. The one
that bites most often is `head` — use `head -n 20`, not `head -20`.

### Storage layout

Everything lives under one directory on the device:

```
/home/root/.local/share/remarkable/xochitl/
  <doc-uuid>.metadata       visible name, parent folder (or "trash")
  <doc-uuid>.content        the page index — ordered list of page uuids
  <doc-uuid>/<page-uuid>.rm one page's strokes
  <doc-uuid>.thumbnails/<page-uuid>.png   ink-composited page render
```

Two facts about this layout carry the whole recovery:

- **A stroke file exists independently of the index.** When `.content` gets
  rewritten with fresh page uuids, the old `.rm` files stay on disk,
  unreferenced by anything — orphaned, not gone.
- **Thumbnails survive the clobber under the old page uuids.** They're the
  map that turns a pile of uuids back into "oh, that's page 7's margin
  notes" — the identification step below depends on this.

### Manual step 1 — back up everything, before any write

Tar the whole document directory off the device first:

```sh
ssh <destination> \
  'cd /home/root/.local/share/remarkable/xochitl && tar czf - <doc-uuid>*' \
  > doc-backup.tar.gz
```

(Through a relay: `ssh -J <jump-host> <destination> '...'` — same command,
one more hop.) Now anything that goes wrong from here has a local copy to
fall back to.

### Manual step 2 — find the orphans

List stroke files newer than the loss and cross-reference against what's
still indexed:

```sh
ssh <destination> \
  'cd /home/root/.local/share/remarkable/xochitl && find . -name "*.rm" -mmin -N'
```

(`-mmin -N` — files modified in the last N minutes; adjust to your incident's
timing.) To find the document's uuid in the first place, grep the visible
name out of the metadata files:

```sh
ssh <destination> \
  'cd /home/root/.local/share/remarkable/xochitl && grep -l "<visible name>" *.metadata'
```

### Manual step 3 — identify each orphan by its thumbnail

A pile of `<page-uuid>.rm` files means nothing on its own. Pull the matching
thumbnails and look at them — that's the eye-match step that turns uuids
into "this is the page with the diagram" or "this is the empty one":

```sh
scp <destination>:/home/root/.local/share/remarkable/xochitl/<doc-uuid>.thumbnails/<page-uuid>.png .
```

Do this for every orphaned uuid before deciding how to reattach — guessing
which stroke file goes where is exactly the mistake the thumbnails exist to
prevent.

### Manual step 4 — reattach

Two shapes, pick the one that matches what you found:

**A. One known page, one known target** — you know exactly which orphaned
`.rm` belongs on which page that's currently live in the document. Copy the
orphaned stroke file so its filename becomes the *target* page's uuid (the
one currently in `.content`'s pages list):

```sh
ssh <destination> \
  'cp /home/root/.local/share/remarkable/xochitl/<doc-uuid>/<orphan-page-uuid>.rm \
      /home/root/.local/share/remarkable/xochitl/<doc-uuid>/<target-page-uuid>.rm'
```

**B. Many or unknown pages** — rebuild the document's page index instead of
retargeting individual files: edit `.content`'s `pages` list (a flat JSON
array of page uuids) back to the orphaned page uuids you identified in step
3, in the order the thumbnails show they belong. Pull the file down, edit it
locally, push it back:

```sh
scp <destination>:/home/root/.local/share/remarkable/xochitl/<doc-uuid>.content .
# edit the "pages" array locally
scp <doc-uuid>.content <destination>:/home/root/.local/share/remarkable/xochitl/<doc-uuid>.content
```

Either way, the write has to happen with xochitl stopped — see the ritual
below. Don't write to either file while xochitl is running.

### The write ritual

xochitl caches the document index in memory and will overwrite anything
written behind its back. Every write to `.content` or a `.rm` file goes
through this sequence, no exceptions:

```sh
ssh <destination> 'systemctl stop xochitl'
# ... apply the reattach from step 4 ...
ssh <destination> 'sync'
ssh <destination> 'systemctl start xochitl'
```

### Manual step 5 — verify

After xochitl restarts:

1. Confirm it actually came back: `ssh <destination> 'systemctl status xochitl'`.
2. Open the document **on the device** and confirm the ink is visible and on
   the right pages — this is the one point in the procedure where touching
   the tablet is correct, because the risky window has closed.
3. Confirm it syncs up: watch for the sync indicator, or re-check from the
   cloud side with `npx -y remarkable-axi get "<path>" --as svg` once you'd
   expect the sync to have completed. Recovery here produces **live ink,
   not a baked render** — the device pushes the recovered strokes up itself.

If the ink isn't there or isn't syncing, the tar from step 1 is still your
fallback — nothing about this procedure is destructive to it.
