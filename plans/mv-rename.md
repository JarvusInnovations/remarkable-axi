---
status: done
depends: []
specs:
  - specs/behaviors/path-uniqueness.md
  - specs/commands/README.md
issues: []
---

# Plan: `mv --name`, and the collision guard it needs

## Scope

Give `mv` the ability to name what it lands, and give it the occupied-path
refusal it should always have had.

Renaming is currently unreachable from the CLI even though `api.rename` is
already used internally (by `put --replace`, to date the superseded copy). The
gap has a real cost: **archiving anything requires a download-and-reupload
round trip purely to attach a name**, which for an annotated document means
flattening live ink into pixels to accomplish a rename.

Out of scope: a general `rename` command. `--name` on `mv` covers rename-in-place
(same destination folder, different name), matches `put --name`'s existing
meaning exactly, and keeps "destination is always a folder path" intact —
no `mv a b`-style ambiguity where a typo'd folder silently becomes a rename.

## Implements

- **specs/behaviors/path-uniqueness.md § On write** — `mv` refuses an occupied
  landing path as `EXISTS`, naming the occupant; a same-folder move stays a
  no-op *unless* `--name` differs, which makes it a rename.
- **specs/commands/README.md** — the surface line.

## Approach

**The collision guard is not optional garnish on this feature — it is the
feature's safety.** `mv` today resolves a destination folder and moves, with no
check that the landing path is free, so it can manufacture exactly the
duplicate state `put` refuses to create and every other command refuses to
operate on. `--name` widens that hole (a name the user typed, dropped into a
folder they cannot see), so the guard lands in the same change.

**`--name` over a positional target path.** Unix `mv a b` decides between
"move into b" and "rename to b" by whether `b` exists — a footgun where a
mistyped or not-yet-created folder silently becomes a rename. An agent-facing
CLI should not have a mode that flips on the state of the filesystem, so the
destination stays unambiguously a folder and the new name is explicit.

## Validation

- [x] `mv <path> <dir> --name <n>` moves and renames in one call
- [x] `mv <path> <same-dir> --name <n>` renames in place (not a no-op)
- [x] `mv <path> <same-dir>` with no `--name` stays a no-op
- [x] A move whose landing path is occupied fails `EXISTS`, names the
      occupant's short id, and moves nothing
- [x] `--name` colliding in the destination fails the same way
- [x] The pre-existing no-guard behavior is gone — a plain `mv` onto an
      occupied name refuses rather than duplicating
- [x] Live: shelve a real week scroll with `mv --name` and confirm the ink
      survives as live strokes (the reason this exists)

## Risks / unknowns

- **This tightens an existing behavior.** A plain `mv` that used to succeed
  into an occupied name now fails. That is the specified rule rather than a
  new opinion, and the duplicate it used to create was unusable by every
  other command — but it is a behavior change, not purely additive.
- **Rename-in-place reads slightly awkwardly** (`mv /A/x /A --name y`). Judged
  better than a positional target whose meaning depends on what exists.

## Notes

**Shelved a real annotated scroll on 2026-08-24**: an 8-page week carrying live
strokes moved to `/Daily/Weeks/2026-W34` in one call, ink intact as strokes,
document identity and `lastModified` preserved — which is the right archive
semantics, since the shelf reads as "last touched Thursday" rather than "made
today."

**The move removed the last `--discard-ink` from the whole weekly cycle.** The
old shelf ritual baked the week to a flat PDF purely to attach a name on
re-upload, then discarded the live layer. Both steps existed only because
rename was unreachable.

**It also relaxed an ordering constraint nobody had questioned.** The scribble
sweep had to happen *before* rotation, because rotation destroyed the ink.
Moving preserves it indefinitely, so triage is now a backend task against the
shelf rather than a gate on starting the week.

**One wording bug surfaced next door**: `put --replace` reports
`last_synced: <age of entry.lastModified>` with the gloss "ink written
on-device since then is invisible to this check." For a document nobody has
touched, that reads as device-sync staleness when it only ever measures the
document — it sent this session chasing a sync problem that did not exist
while the tablet was syncing other notebooks hourly.

## Follow-ups

- **Issue** — reword or re-source `put --replace`'s `last_synced`. The honest
  comparison is against the account's most recently modified item: if anything
  else synced an hour ago, this document being days old means *nothing was
  written*, not *nothing arrived*.
