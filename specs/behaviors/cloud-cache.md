# Behavior: Cloud cache

## Rule

The document tree is cached locally and validated by the root generation. A view of
the tree costs one request when nothing has changed, and work proportional to what
changed when something has.

## Applies To

The home view, `ls`, `find`, and every command that resolves a path.

## Details

### Why

The home view runs on a session-start hook with a hard timeout — 10s in the reference
configuration. Walking the tree on an account with several hundred documents does not
fit that budget, and an overrunning hook produces **no output at all**. The failure is
silent: the tool appears to have no ambient context rather than a slow one.

### The cache is generation-keyed, not time-keyed

The tree is content-addressed under a monotonic generation counter, and the root call
returns `{hash, generation}` without touching the tree. So:

- **Root hash unchanged** → the entire cached tree is valid. Serve it. One request.
- **Root hash changed** → the root index gives every document's own hash; fetch
  metadata only for the documents whose hash moved.

This is not a TTL. A cached answer is either provably current or provably stale, so
there is no staleness window to tune and no correct-but-arbitrary expiry to explain.

### The delta is the recent list

The documents whose hashes moved are exactly the documents the home view's "recent"
section wants to show. Computing the delta and rendering the ambient view are the same
work, so the view gets *cheaper* the more state is kept, not more expensive.

### Degradation

If the root call itself fails or exceeds its deadline, the cached tree is served with
its age stated, rather than nothing:

```
status: "paired, 686 documents, 115 folders (cached, 4h old — cloud unreachable)"
```

A stale answer with its age is useful; an empty hook output is not.

### Invalidation and scope

- The cache is per-account, keyed alongside the pairing token in
  `~/.config/remarkable-axi/`.
- Any mutation this tool performs updates the cache from the result rather than
  discarding it.
- `doctor` reports the cache's generation and age; it can be discarded and rebuilt
  from scratch by an explicit flag, which is the only supported repair.

## Principles

**Inherited** — project principles that especially bite here:

- [Ambient context must not cost account size](../principles.md#ambient-context-must-not-cost-account-size)
  — the whole of this behavior.
