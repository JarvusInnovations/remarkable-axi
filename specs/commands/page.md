# Command: page

## Usage

```
page [--device <model>] [--landscape] [--css]
```

Report the target device's page box, and the CSS to author a document against it.

## Behaviour

`page` makes no cloud call and reads no local document. It is instantaneous and works
unpaired — its only input is the device target from `setup device`, overridable per
invocation with `--device`.

It exists because the geometry is needed *while writing the layout*, not only when
rendering it. An author sizing an element to the full page width needs the number
inline; without it that number gets derived by hand, and a hand-derived page box is
how documents end up sized for hardware nobody owns.

## Output

```
device: RM110 (reMarkable 2)
screen: 1404x1872 @ 226dpi
page: 447x596pt
```

With `--css`, a block to paste into the document being authored:

```
@page { size: 447pt 596pt; margin: 0; }
:root { --page-w: 447pt; --page-h: 596pt; }
html, body { width: 447pt; height: 596pt; margin: 0; }
```

The custom properties are there so internal layout math references the page box by
name rather than by a repeated literal.

## Relationship to render

`page` reports; [render](render.md) enforces. An author who never runs `page` still
gets a correctly sized document, because `render` injects the box when none is
declared. `page` exists for the layout math *inside* the page, which the tool cannot
write for them.

## Failure

| Condition | Code |
| --- | --- |
| no device target and no `--device` | `NO_DEVICE`, listing the models |
| `--device` names an unknown model | `USAGE`, listing the models |

## Principles

**Inherited** — project principles that especially bite here:

- [The tablet is a design target, not just a destination](../principles.md#the-tablet-is-a-design-target-not-just-a-destination)
  — the reason a command exists purely to hand over geometry.
- [Ambient context must not cost account size](../principles.md#ambient-context-must-not-cost-account-size)
  — `page` touches no cloud state, so it stays instant on any account.
