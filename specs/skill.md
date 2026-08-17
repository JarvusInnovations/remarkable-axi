# The companion skill

## What it is

One installable Agent Skill, shipped from this repo (`npx skills add`), covering
the whole tool — not one skill per topic. It is the tool's second discovery path
per the AXI standard: the SessionStart hook carries live ambient state; the skill
loads on matching *intent* with no per-session cost, in any agent that supports the
format.

## Scope: what the skill owns and what it must not

The CLI teaches its own workflows — the design loop's standalone principle
([design-loop](behaviors/design-loop.md#principles)) binds every command-surface
flow: nothing about operating the tool may depend on the skill existing. What the
skill *uniquely* owns is the content that cannot live in command output because it
is entered from a **symptom**, not from a command:

- **The ink-recovery playbook** — the meatiest section. Triage ("cloud shows zero
  ink" → orphaned vs merely-unsynced vs trashed-but-local); the hands-off
  discipline — from the moment loss is suspected until recovery completes, nobody
  opens documents, writes, or launches the desktop app; the device's Wi-Fi stays
  *on* because SSH arrives over it, and the backup tar as recovery's first act is
  what bounds the exposure (see
  [device-access](behaviors/device-access.md#connectivity-a-destination-not-a-topology));
  then the recovery sequence across the [device commands](commands/device.md) with
  the thumbnail eye-match judgment step in the middle, mode choice
  (`--map` vs `--restore-index`), and post-recovery verification that the ink is
  live and syncing. Grounded in the mechanism defined in
  [ink-preservation](behaviors/ink-preservation.md#cloud-checks-see-only-synced-ink).
- **Prevention doctrine** — replace during windows the user has not been writing
  in; sync the tablet before an ad-hoc replace of an inked document; what
  `last_synced` in replace output means and when it should change the plan.
- **One-time setup walkthroughs** whose steps are manual and on-device: enabling
  SSH, reading the About-screen password, installing a key, choosing a direct
  destination versus a `--via` relay.

Command reference material in the skill is **generated from `reference.ts`**
(the single-source rule in [architecture](architecture.md#command-surface-has-one-source)),
with a CI check that fails when the committed skill is stale. The playbook sections
are hand-authored; they cite commands by name and never restate their flags.

## Structure

One skill, progressive disclosure, sub-procedures broken out:

```
skill/
├── SKILL.md            lean — orientation, the workflows in brief, the generated
│                       command-reference region, and pointers into references/
└── references/
    ├── ink-recovery.md the incident playbook (triage → hands-off → backup →
    │                   identify → reattach → verify)
    └── ssh-setup.md    the one-time device-SSH walkthrough (enable, key install,
                        destination vs --via)
```

SKILL.md stays in lavish-axi's register: short, workflow-first, every command
example runnable without a global install (`npx -y remarkable-axi …`), and each
reference file named from SKILL.md with a one-line cue for *when* to open it —
the frontmatter description triggers the skill; the reference files load only
when their procedure is actually in play. A sub-procedure earns a reference file
when it would otherwise bloat SKILL.md past quick-orientation size; it merges
back in if it withers to a paragraph.

The skill is built and iterated with the skill-creator loop — draft, run
realistic test prompts (including symptom-phrased ones like "my handwriting from
this morning is gone"), review, tighten — and its description is
trigger-optimized against should/should-not-trigger cases before it ships.

## Triggers

The frontmatter description triggers on symptoms and intents, not tool names
alone: lost/missing handwriting or annotations, a reMarkable showing blank pages
that were written on, designing a page for the tablet, sending documents to a
reMarkable — so the skill loads at the moment its judgment is needed, including
before the user knows this tool is the answer.

## Sequencing

The playbook does not wait for the `device` commands: the recovery procedure is
runnable today as raw SSH steps (proven in two real incidents), so the skill may
ship with the manual procedure and absorb each `device` command as it lands,
replacing shell fragments with tool invocations. At every point the published
skill describes the current shipped surface — never a future one.

## Principles

**Inherited** — project principles that especially bite here:

- The design-loop's [standalone principle](behaviors/design-loop.md#principles) —
  the skill amplifies workflows the CLI already teaches; it is never the only
  place one lives.
- [Nothing the user made is destroyed without a findable copy](principles.md#nothing-the-user-made-is-destroyed-without-a-findable-copy)
  — the playbook's backup-first and freeze-first ordering is this principle
  practiced under incident conditions.
