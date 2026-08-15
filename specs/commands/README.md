# Commands

The whole surface. Groups match the display groups in `src/reference.ts`, which is
the single source the home view, `--help`, and the generated SKILL.md region derive
from.

```
Design
  page [--device <model>] [--landscape] [--css]     device page box, and CSS to author against
  render <html> [--out <path>]                      HTML → PDF at the device page box
  check <file> [--pages <spec>]                     rasterize + lint a document for the device

Move
  put <src> <dest>                                  local file or URL → tablet
  get <path> [<dest>]                               tablet → local file

Browse
  ls [<path>]                                       list a folder
  find <pattern>                                    search names
  devices                                           known models and their page boxes

Organize
  mkdir <path>                                      create a folder and missing parents
  mv <path> <dest>                                  move into another folder
  rm <path>                                         move to trash

Setup
  login <code>                                      pair this machine
  doctor                                            pairing, connectivity, external tools, cache
  setup device <model>                              set the device to design for
  setup hooks                                       install SessionStart hooks
```

## Shape

Every command that moves or names something takes **source first, destination last**,
and a destination is always a path. See
[Destination last, and always a path](../principles.md#destination-last-and-always-a-path).

Data moves in exactly two directions, so there are exactly two verbs for it: `put`
and `get`. What the source *is* — PDF, EPUB, HTML, URL — dispatches internally and
never earns a verb or a mode flag. See
[One verb per direction; the source type dispatches](../principles.md#one-verb-per-direction-the-source-type-dispatches).

## Specified

- [page](page.md) · [render](render.md) · [check](check.md)
- [put](put.md) · [get](get.md)

The remaining commands are existing behavior awaiting spec backfill.

## Deprecations

Three commands are absorbed by the shape above. Each is retained as a **targeted
redirect** — not a generic unknown-command error — so an agent self-corrects in one
turn, per the AXI rule for renamed surface.

| Retired | Replacement | Why |
| --- | --- | --- |
| `send <url> [--dir]` | `put <url> <dest>` | a URL is a source type, not a verb |
| `replace <path> <file>` | `put <file> <path> --replace` | a replace is a put with a destination that exists |
| `fetch <path>` | `get <path> [<dest>]` | names the direction, pairing with `put` |

```
$ remarkable-axi send "https://example.com/post" --dir /Articles
error: `send` was folded into `put`; a URL source is detected automatically
help: remarkable-axi put "https://example.com/post" /Articles
```

`--keep-old` is retired outright rather than redirected. Its only function was to
leave two documents at one path — the state the tool refuses to operate on, and which
`--replace` itself rejects on the next run. `--keep-ink`, described in
[ink-preservation](../behaviors/ink-preservation.md#carrying-ink-forward-not-yet-shipped),
occupies the intent it was reaching for, but is not implemented — see that spec for
why. `--replace`'s own `HAS_INK` refusal (also in ink-preservation) covers saving the
annotated version separately in the meantime.

```
$ remarkable-axi put draft.pdf /Papers/Draft --replace --keep-old
error: --keep-old is retired; it left two documents at one path
help: to save the annotated version first, use `remarkable-axi get <path> --overlay <file>.pdf`
      to keep the old version as a separate document, give it a distinct --name
```
