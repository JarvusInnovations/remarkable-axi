---
status: done
depends: []
specs:
  - specs/commands/README.md
  - specs/commands/put.md
  - specs/commands/get.md
  - specs/behaviors/path-uniqueness.md
issues: []
pr: 18
---

# Consolidate the surface onto put and get

## Scope

Reduce three upload verbs to one and name the download direction to match. Retire
`send`, `replace`, and `fetch` behind targeted redirects; retire `--keep-old`
outright. Add `--as original`. Refuse writes to an occupied path.

Out of scope: HTML sources for `put` (needs `render`), and the ink guard on
`--replace` (its own plan). This plan lands the shape.

## Implements

- `specs/commands/README.md` — groups, redirects
- `specs/commands/put.md` — minus the HTML dispatch and ink flags
- `specs/commands/get.md`
- `specs/behaviors/path-uniqueness.md`

## Approach

Today the three upload verbs disagree on argument order, on whether a destination is a
folder or a path, and on whether it is positional or a flag — and the same concept is
`--name` in one and `--title` in another. Collapse to source-first, destination-last,
destination-always-a-path.

`--replace` becomes a modifier on `put` rather than a command, which is what it always
was: a verified put. Its existing composite ordering is preserved — upload first, then
trash the superseded document by id, so a failed upload leaves the original intact.

`get` takes over `fetch` and gains `--as original`, closing a real gap: a document
could be sent to the tablet and never retrieved, because the tool could render ink but
not return the file it was drawn on.

`--keep-old` is deleted, not redirected. Its only effect was leaving two documents at
one path — the state `replace` itself rejects on the next run, so using it once bricked
the path.

Deprecations are targeted redirects that name the replacement invocation, per the AXI
rule that an error should be self-correcting in one turn.

## Validation

- [x] `put <pdf|epub> <dest>` lands at a folder or an exact path; missing parents created
- [ ] `put <url> <dest>` extracts and converts without a flag
- [x] `put` to an occupied path refuses, uploads nothing, exits non-zero, names both intents
- [ ] `put --replace` swaps contents and leaves exactly one document at the path
- [x] `put --replace` on an ambiguous path refuses without picking a victim
- [x] `get <path>` writes to `./<name>.<ext>`; `get <path> <dest>` honors the destination
- [ ] `get --as original` returns the uploaded file byte-identical
- [x] `get --as original` on a notebook fails with `NO_ORIGINAL` naming the render formats
- [x] `send`, `replace`, `fetch`, `--keep-old` each error with the replacement invocation
- [ ] `ls` and `find` mark duplicated names with their short ids
- [ ] `doctor` reports the account-wide duplicate count
- [x] `reference.ts` is the only place any of this is documented; SKILL.md region regenerates

Notes on what "verified" means here, since no test mocks `RemarkableApi` and a
paired token happened to be present on the build machine (never exercised —
see Notes below): a box is checked only when either (a) a unit test covers the
exact decision logic a command's guard clause forwards into a throw — this is
true for the occupied-path/ambiguous-path refusals (`resolvePutDestination`,
`nodesAt`), `get`'s destination shape (`resolveGetDestination`), and
`NO_ORIGINAL` (`originalExtension`) — or (b) a CLI smoke test reached the
result without any network call (the three deprecation redirects, `--keep-old`,
and `put`'s pre-network refusals). Left unchecked: anything that needs an
actual successful network mutation or a real byte-for-byte cloud round trip
(URL extraction, `--replace`'s live rename-then-trash, `--as original`'s
byte-identity), and `ls`/`find`/`doctor`'s duplicate-marking *output* — the
underlying `duplicatePaths` primitive is unit tested, but the field-placement
and count arithmetic in `browse.ts`/`setup.ts` was never exercised by any test
(these commands have no test coverage at all, before or after this plan) or a
live run, so downgraded to unchecked rather than claimed on inspection alone.

## Risks / unknowns

Breaking change to every existing invocation. Needs a major version and release notes
that lead with the redirect table.

`put <src> <dest>` where `<dest>` names a folder that does not exist is ambiguous — is
it a new folder to create, or the document's full path? Spec says trailing segment is
a folder if it exists and a document path otherwise; confirm that reads naturally
before building, since it is the one place the shape is not self-evident.

## Notes

**The trailing-segment ambiguity reads fine.** `put file.pdf /Papers` when `/Papers`
exists lands inside it; `put file.pdf /Papers/Draft` when nothing exists at that path
creates `/Papers` and lands the document named `Draft` — no case felt surprising once
`resolvePutDestination`'s tests were written against it.

**Occupied-path refusal applies to the *resolved* final path everywhere, not only an
explicit `<dest>`.** `put.md`'s Destination bullets spell out refusal only for
`<dest>` itself already naming a document; this build also refuses when `<dest>` is a
folder and the *derived* name collides with an existing sibling inside it (e.g.
`put report.pdf /Papers` when `/Papers/report` already exists). The "Occupied
destination" section and `path-uniqueness.md`'s write rule are both written in terms
of "a path already holding a document" generally, and the "never manufacture a
duplicate" principle doesn't distinguish the two cases — so this reads as the correct,
consistent interpretation rather than an invention. Flagging per the plan's
instruction: landing into a busy folder with a source-derived name is the more common
flow of the two, so this refusal will fire more often in practice than the
explicit-path case the spec bullets show. If that turns out to read badly once used
for real, the alternative is to keep the hard refusal only for the explicit-path case
and fall back to the old warn-and-duplicate behavior for folder-landing collisions —
but that reintroduces exactly the state the tool is meant to refuse to manufacture, so
I'd want that discussed rather than silently chosen.

**A paired token was present on the build machine throughout this work.** `bun run
test`/`check`/`build` and CLI smoke tests never exercise `client()` for anything that
would mutate state — every live-path check performed (`--keep-old`, `.html` source,
unsupported extension, missing file, missing destination) throws before the network
call. No `put`/`get` invocation that could reach `client()` and mutate or fetch real
account data was run. Nothing was uploaded, replaced, or fetched against any tablet.

**`--force` had to be added to `get`'s flag set to satisfy its own Failure table** —
see Follow-ups.

## Follow-ups

- Issue: `specs/commands/get.md`'s Flags table doesn't list `--force`, but its
  Failure table requires it (`destination exists | EXISTS unless --force`). Added
  `--force` to the implementation and to `reference.ts`'s `get` entry; the Flags
  table itself still needs the row added to close the gap.
- Deferred to plan `render-command`: HTML sources for `put`. Currently fails
  `UNSUPPORTED_FORMAT` naming that `render` isn't built yet, per this plan's
  explicit scope.
- Deferred to plan `ink-preservation`: the ink guard on `--replace` (`HAS_INK`,
  `--keep-ink`, `--discard-ink`). `--replace` here has no ink awareness at all —
  it will overwrite an inked document's contents with no warning, same as it did
  before this plan (not a regression, just not yet guarded).
- Tracked as: none filed yet — full `put`/`get` execution against a live account
  (URL extraction, `--replace`'s rename-then-trash, `--as original` byte-identity,
  `ls`/`find`/`doctor` duplicate-marking output) needs verification against a
  paired account by someone who can do so safely; see the Validation notes above
  for exactly what's unverified and why.
