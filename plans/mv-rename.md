---
status: in-progress
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
- [ ] Live: shelve a real week scroll with `mv --name` and confirm the ink
      survives as live strokes (the reason this exists)

## Risks / unknowns

- **This tightens an existing behavior.** A plain `mv` that used to succeed
  into an occupied name now fails. That is the specified rule rather than a
  new opinion, and the duplicate it used to create was unusable by every
  other command — but it is a behavior change, not purely additive.
- **Rename-in-place reads slightly awkwardly** (`mv /A/x /A --name y`). Judged
  better than a positional target whose meaning depends on what exists.

## Notes

*Populated at closeout.*

## Follow-ups

*Populated at closeout.*
