# Behavior: Path uniqueness

## Rule

A path identifies at most one document. The tool never creates a second document at
an occupied path, and surfaces duplicates it encounters wherever it encounters them.

## Applies To

`put`, `ls`, `find`, `doctor`, and every command that resolves a path to a document.

## Details

### Why prevention alone is not enough

The cloud permits two documents with the same name in the same folder; the device and
other clients create them freely. So duplicates arrive without this tool's
involvement, and prevention cannot be the whole answer.

Today the only thing that reports a duplicate is an unrelated command failing on it,
which is the worst possible moment to learn. Detection is therefore a standing
obligation of the browse and health commands, independent of how tightly the write
path is guarded.

### On write

`put` to a path already holding a document **refuses** — exit non-zero, nothing
uploaded — and names the two real intents:

```
error: /Papers/Draft already exists (a3f21b0c)
help: replace it —
        remarkable-axi put draft-v2.pdf /Papers/Draft --replace
      or land a distinct document —
        remarkable-axi put draft-v2.pdf /Papers --name "Draft v2"
```

There is no flag that uploads a second document to an occupied path. See
[Never manufacture a state the tool refuses to operate on](../principles.md#never-manufacture-a-state-the-tool-refuses-to-operate-on).

### On read

`ls` marks duplicated names in its listing and reports the count in its summary.
`find` does the same. Both include the short id of each colliding document, because
the id is the only thing that can disambiguate them for `rm` or `mv`.

`doctor` reports the account-wide count of duplicated paths, and names the first
several with their ids.

### On resolve

A command given a path that resolves to more than one document fails as `AMBIGUOUS`,
lists the colliding ids, and suggests removing or renaming down to one. It never
picks a victim.

## Principles

**Inherited** — project principles that especially bite here:

- [Never manufacture a state the tool refuses to operate on](../principles.md#never-manufacture-a-state-the-tool-refuses-to-operate-on)
  — the whole of this behavior.
