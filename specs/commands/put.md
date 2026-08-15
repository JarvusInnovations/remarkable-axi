# Command: put

## Usage

```
put <src> <dest>
```

Send something to the tablet. `<src>` is a local file or a URL; `<dest>` is a path.

## Flags

| Flag | Effect |
| --- | --- |
| `--name <name>` | document name shown on the device (default: derived from source) |
| `--replace` | swap the contents of the document already at `<dest>` |
| `--keep-ink` | with `--replace`, carry the superseded document's ink onto the new one |
| `--discard-ink` | with `--replace`, proceed when the target carries ink |
| `--device-page` | override an HTML source's declared `@page` with the device page box |
| `--strict` | treat `check`-level error findings as fatal instead of warnings |

## Source dispatch

| `<src>` | Handling |
| --- | --- |
| `.pdf`, `.epub` | uploaded as-is |
| `.html` | rendered to PDF at the device page box, then uploaded — see [render](render.md) |
| `http(s)://` URL | article extracted and converted to EPUB, then uploaded |

Dispatch is by inspection, never by flag. Adding a source format must not add a flag
or a command — see
[One verb per direction; the source type dispatches](../principles.md#one-verb-per-direction-the-source-type-dispatches).

The cloud accepts PDF and EPUB only; every other source is converted before upload,
and an unconvertible source fails as `UNSUPPORTED_FORMAT` naming what is accepted.

## Destination

`<dest>` is a path. Its trailing segment is a folder to place the document in, or the
full path of the document itself:

- `/Papers` (existing folder) → land inside it, named per `--name` or the source.
- `/Papers/Draft` (no such document) → land at exactly that path.
- `/Papers/Draft` (document exists) → **refuse** unless `--replace`; see below.

Missing parent folders are created.

## Occupied destination

Without `--replace`, an occupied destination refuses — nothing is uploaded, exit
non-zero — and names the two real intents. There is no flag that lands a second
document at an occupied path. See
[path-uniqueness](../behaviors/path-uniqueness.md).

**Occupied is judged on the resolved final path**, not on whether `<dest>` itself
named a document. Landing in a folder derives a name from `--name` or the source, and
if that name collides with a sibling the result is two documents at one path just the
same — so it refuses identically. This fires on the common folder-landing flow, which
is intended: the alternative is a tool that prevents duplicates only in the case the
user was already being explicit about.

## Replacing

`--replace` uploads the new document, then moves the superseded one to trash under a
dated name. It refuses when the destination is ambiguous rather than picking a victim,
and it refuses when the target carries ink unless `--keep-ink` or `--discard-ink` is
given. All of that is [ink-preservation](../behaviors/ink-preservation.md).

A failed upload leaves the original untouched: the new document lands first, and the
old one is trashed only after the upload is confirmed.

## HTML sources and page geometry

An HTML source is rendered at the device page box, with `@page` detection and the
mismatch report defined in [page-geometry](../behaviors/page-geometry.md). `put` runs
the same lint `check` does and reports findings alongside the upload; `--strict` makes
error-severity findings fatal.

Warning-not-blocking is deliberate: a hairline that will not resolve on the panel is
worth knowing about, but not worth refusing a document the user already decided to
ship.

## Success output

```
uploaded:
  name: Draft
  path: /Papers/Draft
  size: 319KB
  format: pdf
help[1]: Run `remarkable-axi ls /Papers` to confirm it landed
```

Replacing adds the backup and, with `--keep-ink`, the per-page ink table from
[ink-preservation](../behaviors/ink-preservation.md).

## Failure

| Condition | Code |
| --- | --- |
| source missing or unreadable | `NOT_FOUND` |
| source format not convertible | `UNSUPPORTED_FORMAT` |
| destination occupied, no `--replace` | `EXISTS` |
| destination resolves to several documents | `AMBIGUOUS` |
| `--replace` target carries ink, no ink flag | `HAS_INK` |
| `--replace` given, nothing at destination | `NOT_FOUND`, suggesting the plain form |
| HTML source, no device target set | `NO_DEVICE`, naming `setup device` |

## Principles

**Inherited** — project principles that especially bite here:

- [One verb per direction; the source type dispatches](../principles.md#one-verb-per-direction-the-source-type-dispatches)
  — why `send` and `replace` are not commands.
- [Destination last, and always a path](../principles.md#destination-last-and-always-a-path)
  — why the destination is not a `--dir` flag and not the first positional.
- [Never manufacture a state the tool refuses to operate on](../principles.md#never-manufacture-a-state-the-tool-refuses-to-operate-on)
  — the occupied-destination refusal.
