---
status: planned
depends: []
specs:
  - specs/behaviors/cloud-cache.md
issues: []
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
- [ ] Second consecutive home view issues exactly one cloud request
- [ ] A tree changed on the device is reflected on the next invocation, not on a timer
- [ ] Cloud unreachable serves the cached tree with its age stated, exit 0
- [ ] No cache present and cloud unreachable fails with a structured error, not an empty response
- [ ] `doctor` reports cache generation and age; the discard flag forces a full rebuild
- [ ] A mutation by this tool leaves the cache current without a refetch

## Risks / unknowns

The measured baseline is 13.9s against a 10s hook timeout, so the hook has been
producing no output at all — the fix has to be verified against a real account, not a
synthetic one, because the failure mode is a silent overrun rather than an error.

Unknown whether the root index alone carries enough per-document data to render the
recent list, or whether each changed document still needs a metadata fetch. If the
latter, a session where many documents changed is still slow, and the degradation path
carries more weight than expected.

## Notes

## Follow-ups
