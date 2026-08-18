# Behavior: Design loop disclosure

## Rule

The tool teaches the page-design workflow through next-step hints in its own output:
**`page` to get the geometry → author → `check` and read the page image by eye →
iterate → `put`.** Each stage's output names the next stage and states that it comes
before the upload. The chain is guidance only — no command refuses, prompts, or
gates on whether a previous stage ran.

## Applies To

The home view, `page`, `check`, and `render`. `put` is the end of the chain and
carries no design hints.

## Details

### Why hints, not a gate

The step that matters most — judging the layout by eye on the rendered page image —
is the one step the tool cannot observe. A gate could only test a proxy ("a `check`
ran"), which proves the evidence was generated, not that anyone looked at it, and it
would fire equally on flows where no design judgment is pending — re-rendering a
known-good template, shipping an update to a document already on the device. That is
precisely the gate [principles.md](../principles.md#best-effort-operations-report-per-item-outcomes)
rules out: it blocks legitimate cases while providing no assurance against the real
failure mode.

So the workflow is carried entirely by contextual disclosure. Hints walk an agent
mid-design forward one stage at a time; an agent that already knows what it wants
ignores them and loses nothing.

### The chain

Each hint is a complete runnable command with placeholders for runtime values, and
the sequencing lives in the phrasing ("before you put", "before any upload") rather
than in any enforcement.

**Home view** — the design entry point rides in the standing help lines:

```
Run `remarkable-axi page --css` to start designing a page for the tablet — check and eyeball a preview before you put
```

**`page`** — points at `check` as the iteration loop:

```
Run `remarkable-axi check <html>` as you iterate — it renders and lints in one call, before any upload
```

**`check`** — when page images were written, the output surfaces the eye-pass (the
one step no finding measures) and the exit from the loop:

```
Read <first image path> to critique the layout by eye — findings measure the panel, not the design
Run `remarkable-axi put <file> <dest>` once the layout reads well
```

The `put` hint carries the checked file forward as its source. Alongside these,
`check` keeps the hint required by its own spec whenever images are preview-scaled —
the `--full-res` escape hatch (see [check](../commands/check.md)).

**`render`** — keeps its existing hint pointing at `check`; it is a side door into
the same loop.

### The taught loop is check-on-HTML, not render-then-check

`check` accepts HTML and renders it exactly as `render` would, so the loop the hints
teach is one command per iteration, not two. `render` exists for when the sized PDF
is itself the deliverable; the design loop never needs it.

## Principles

**Local** — principles owned by this behavior:

- **The tool teaches the loop standalone.** Every hint in the chain lives in the
  CLI's own stdout. Session hooks and installable skills may repeat the guidance,
  but nothing about the workflow's discoverability may depend on them: a bare
  `npx -y remarkable-axi` install must walk an agent through the full loop with no
  companion artifacts present.

**Inherited** — project principles that especially bite here:

- [The tablet is a design target, not just a destination](../principles.md#the-tablet-is-a-design-target-not-just-a-destination)
  — the loop exists so layout is judged against the panel before it lands there.
- [Best-effort operations report per-item outcomes](../principles.md#best-effort-operations-report-per-item-outcomes)
  — its gate clause is why this behavior is hints all the way down.
