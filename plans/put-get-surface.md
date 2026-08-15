---
status: planned
depends: []
specs:
  - specs/commands/README.md
  - specs/commands/put.md
  - specs/commands/get.md
  - specs/behaviors/path-uniqueness.md
issues: []
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

- [ ] `put <pdf|epub> <dest>` lands at a folder or an exact path; missing parents created
- [ ] `put <url> <dest>` extracts and converts without a flag
- [ ] `put` to an occupied path refuses, uploads nothing, exits non-zero, names both intents
- [ ] `put --replace` swaps contents and leaves exactly one document at the path
- [ ] `put --replace` on an ambiguous path refuses without picking a victim
- [ ] `get <path>` writes to `./<name>.<ext>`; `get <path> <dest>` honors the destination
- [ ] `get --as original` returns the uploaded file byte-identical
- [ ] `get --as original` on a notebook fails with `NO_ORIGINAL` naming the render formats
- [ ] `send`, `replace`, `fetch`, `--keep-old` each error with the replacement invocation
- [ ] `ls` and `find` mark duplicated names with their short ids
- [ ] `doctor` reports the account-wide duplicate count
- [ ] `reference.ts` is the only place any of this is documented; SKILL.md region regenerates

## Risks / unknowns

Breaking change to every existing invocation. Needs a major version and release notes
that lead with the redirect table.

`put <src> <dest>` where `<dest>` names a folder that does not exist is ambiguous — is
it a new folder to create, or the document's full path? Spec says trailing segment is
a folder if it exists and a document path otherwise; confirm that reads naturally
before building, since it is the one place the shape is not self-evident.

## Notes

## Follow-ups
