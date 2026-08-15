---
status: done
depends: []
specs:
  - specs/behaviors/cloud-cache.md
issues: []
pr: 16
---

# Generation-keyed tree cache

## Scope

Persist the document tree locally and validate it against the root generation, so the
home view costs one request when nothing has changed. Add graceful degradation to a
stale answer with its age when the cloud is unreachable.

## Implements

- `specs/behaviors/cloud-cache.md`

## Approach

`getRootHash()` returns `{hash, generation}` without touching the tree — that is the
validation call. Cache the built tree alongside the pairing token, keyed by
generation.

On an unchanged root, serve the cache outright. On a changed root, fetch the root
index and re-fetch metadata only for documents whose hash moved; that delta is also
what the home view's recent section renders, so the two are one pass.

Mutations performed by this tool update the cache from their own result rather than
invalidating it, so a `put` does not force the next command to rebuild.

Report generation and age in `doctor`, with a flag to discard and rebuild.

## Validation

- [ ] Home view completes within a 10s session-start hook budget on an account with several hundred documents
- [x] Second consecutive home view issues exactly one cloud request
- [x] A tree changed on the device is reflected on the next invocation, not on a timer
- [x] Cloud unreachable serves the cached tree with its age stated, exit 0
- [x] No cache present and cloud unreachable fails with a structured error, not an empty response
- [x] `doctor` reports cache generation and age; the discard flag forces a full rebuild
- [x] A mutation by this tool leaves the cache current without a refetch

## Risks / unknowns

The measured baseline is 13.9s against a 10s hook timeout, so the hook has been
producing no output at all — the fix has to be verified against a real account, not a
synthetic one, because the failure mode is a silent overrun rather than an error.

Unknown whether the root index alone carries enough per-document data to render the
recent list, or whether each changed document still needs a metadata fetch. If the
latter, a session where many documents changed is still slow, and the degradation path
carries more weight than expected.

## Notes

- **Real-account timing is unverified.** This environment has no real
  reMarkable credentials, so the one validation box left unchecked — the
  headline fix actually clearing the 10s hook budget — could only be
  exercised against a faked api (which proves the call-count claims: one
  request on a cache hit, delta-only refetch on a change) rather than wall
  clock time against a real several-hundred-document account. Tracked as
  issue #17.
- **"The delta is the recent list" is implemented literally when there is a
  delta.** On a changed root, home's `recent` section is exactly the
  documents whose hash moved this call, per the spec. On a cache hit or a
  stale degrade the delta is empty by construction — rather than showing
  nothing every steady-state call, `recent` falls back to a plain recency
  sort over the full, already-in-memory, already-validated tree (zero extra
  network cost either way). Cold start naturally reduces to the pre-cache
  behavior (delta = every document). This is a considered reading of an
  underspecified corner, not a literal contradiction of the spec text — flag
  if the intent was for `recent` to go empty on an unchanged root.
- `doctor`'s `unreadable` count is scoped to the current call's own fetch,
  not a running total across the whole cached tree — on a cache hit nothing
  was refetched, so a permanently-malformed item cached as absent stays
  invisible to `doctor` until the next root change touches it. Same
  limitation the pre-cache `listEntries` had on every call except now it
  only resurfaces on a delta rather than every invocation.
- Command-level mutation wiring (`mkdir`/`mv`/`rm`/`send`/`put`/`replace`
  calling `recordMutation` with a correctly-shaped `Entry`) is covered by
  `bun run check` (the compiler enforces the `Entry` shape) and by
  `cache.ts`'s own `recordMutation` unit tests, but not by a per-command
  integration test — this repo has no command-level test precedent to match
  (only `home.ts` got one, added in this PR). `replace.ts`'s existing
  before/after `listEntries`-style verification now doubles as an implicit
  end-to-end check: its "after" reload is a cache hit that already reflects
  the mutation.

## Follow-ups

- Issue #17 — verify home-view hook timing against a real
  several-hundred-document account; the one unchecked validation box.
- None — the `recent`-on-unchanged-root design reading above is a documented
  judgment call, reversible in a follow-up commit if the intent was
  literally "empty until something changes."
