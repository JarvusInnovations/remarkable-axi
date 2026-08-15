# Principles

The decisive rules behind this tool. Each picks a side of a real trade-off, so an
implementer can resolve an unspecified case the way the author would. A principle
that governs only one command lives in that command's spec under `## Principles`;
this file holds the ones that apply everywhere.

The [AXI standard](https://axi.md) governs output
format, error shape, flag validation, and help — it is assumed throughout and not
restated here. These are the principles specific to driving a reMarkable.

## The tablet is a design target, not just a destination

Most documents that reach the device were authored *for* the device. A page whose
box does not match the panel is not a cosmetic problem: the device renders a PDF at
its natural physical size at ~227dpi and pans, so a small page under-fills the screen
and a large one has to be scrolled to read.

Therefore the tool owns page geometry rather than leaving it to the author. Any
command that produces or evaluates a document must know the target device's page box
and act on it. A user should never have to derive `447 × 596pt` by hand, and should
never learn about a mismatch by looking at the tablet.

## Measure the device; never ship a guessed constant

Where the device's behavior is not documented by the cloud API, it gets calibrated
against real hardware and the measurement gets recorded with its residuals — the ink
placement transform, the pen palette, the legible stroke-weight ratio. A plausible
constant that happens to be wrong produces output that looks authoritative and is
silently misplaced, which is worse than refusing to render.

When a needed constant cannot be measured, the tool reports what it could not
determine rather than substituting a guess (`unmappedColorIndices` is the pattern).

## One verb per direction; the source type dispatches

Data moves two ways: up to the tablet and back down. That is two verbs, `put` and
`get`. What the source *is* — a PDF, an EPUB, an HTML file, a URL — is a detail the
tool detects and handles, never a reason for a new command or a mode flag.

The test: adding support for a new source format must not add a command, a flag, or
a second way to spell the same intent.

## Destination last, and always a path

Every command that moves or names something takes source first and destination last,
`cp`-shaped. A destination is a path — never a folder in one command and a full path
in another, never positional here and a flag there. The same concept carries the same
flag name everywhere.

## Never manufacture a state the tool refuses to operate on

Two documents at one path is a state this tool declines to resolve, because it cannot
know which one the user meant. It follows that no command may *create* that state as a
convenience. Where a command would produce it, it stops and offers the two real
intents instead — replace the existing document, or land a distinctly named one.

Detection is separate from prevention and is not optional: duplicates arrive from the
device and other clients regardless of what this tool does, so the browse and health
commands surface them with ids whenever they are seen. Discovering a duplicate at the
moment an unrelated command fails is the worst time to find out.

## Nothing the user made is destroyed without a findable copy

Ink is unreproducible. Any operation that supersedes a document moves the old one to
trash rather than deleting it, and **renames it on the way** so it is distinguishable
from the document that replaced it. A trash full of identically-named copies is not a
backup.

Because the recoverable copy always exists, operations that transform user content may
be permissive and best-effort rather than defensive. The safety net is the copy plus an
honest report — not a refusal to act.

## Report the mismatch; do not silently correct the author

When an explicit declaration in the user's input conflicts with what the tool would
have chosen, honor the declaration and report the delta with numbers. Silently
overriding is the worse failure: the surrounding work was written against the
declared value, so a correct-looking substitution invalidates everything built on it.

Defaults may be injected freely where the user declared nothing. Overriding what they
*did* declare requires an explicit flag.

## Best-effort operations report per-item outcomes

An operation that can partially succeed never returns a bare success. It reports what
happened to each item and names the ones that did not survive, loudly enough that a
silently smaller result cannot pass for a complete one.

Correspondingly, a gate is only worth having if it tests the variable that actually
carries the risk. A check that blocks a common legitimate case while providing no
assurance against the real failure mode is worse than no gate — it trades usefulness
for the appearance of safety.

## Ambient context must not cost account size

The home view runs on a session-start hook with a hard timeout, on accounts holding
hundreds of documents. Work proportional to the account's size does not fit that
budget, and a hook that overruns produces no output at all — the failure is silent,
so the tool appears to have no ambient context rather than a slow one.

Any always-on view is served from local state validated by a single cheap call, and
degrades to a stale answer with its age rather than to nothing.
