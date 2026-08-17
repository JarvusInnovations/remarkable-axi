---
name: remarkable-axi
description: Use this skill for anything involving a reMarkable tablet. That includes sending or uploading a PDF, EPUB, or URL to the tablet; designing, rendering, or checking a page, flyer, or document against the reMarkable's e-ink screen; browsing or organizing what's on the tablet; and downloading handwriting, ink, annotations, or typed notes off it. Use it immediately whenever notes or handwriting on a reMarkable appear missing or lost — blank pages the user knows they wrote on, ink gone after a sync, or annotations possibly destroyed by replacing a document — because it contains the step-by-step ink-recovery procedure, and the first rule is to stop touching the device. If a query mentions a reMarkable (or "my tablet" in a reMarkable context) plus documents, pages, notes, ink, or sync, use this skill. Do not use it for other devices or apps (iPad, Kindle, Notion), generic file recovery, or printing questions unrelated to the tablet.
metadata:
  hermes:
    tags: [remarkable, e-ink, tablet, handwriting, pdf, epub, recovery]
    category: productivity
---

# remarkable-axi

An [AXI](https://axi.md) CLI for the reMarkable cloud. No install needed —
every command below runs as `npx -y remarkable-axi …`. Run it bare first to
see current pairing status and what's on the tablet:

```sh
npx -y remarkable-axi
```

If it reports `NOT_AUTHENTICATED`, pair with an 8-character code from
<https://my.remarkable.com/device/desktop/connect>:
`npx -y remarkable-axi login <code>`.

## The design → send → pull loop

1. **Design against the panel, not a monitor** — get the page box and a CSS
   block to author against: `npx -y remarkable-axi page --css`.
2. **Check before sending** — rasterize at the device's density and lint
   hairlines, contrast, type size, and page box:
   `npx -y remarkable-axi check flyer.html`.
3. **Send** — `npx -y remarkable-axi put flyer.html "/Talks"`. Replacing an
   inked document refuses by default; see `put --help` for `--replace` and
   `--discard-ink`.
4. **Pull ink back** — `npx -y remarkable-axi get "/Talks/Flyer" --overlay`
   for annotations drawn over the original, or `--as text` for OCR'd text.

## Handwriting looks lost — stop and read this first

"Cloud shows zero ink but I know I wrote something", "the tablet has blank
pages that had notes on them", "did that replace eat my annotations" — these
are all the same failure: strokes the device hadn't synced up yet, orphaned by
a replace or a sync restart that won the cloud's side. **They are not
destroyed; they are recoverable, but only if nobody touches the tablet before
the backup is taken.**

Open [references/ink-recovery.md](references/ink-recovery.md) now, before
opening any document on the device, writing anything, or launching the desktop
app. It carries the triage, the hands-off discipline, and the manual SSH
recovery procedure — proven end to end in two real incidents.

## Reference files

- **[references/ink-recovery.md](references/ink-recovery.md)** — open when
  ink or annotations look missing. Triage, the hands-off rule, backup, and the
  manual SSH reattach procedure.
- **[references/ssh-setup.md](references/ssh-setup.md)** — open the first time
  device recovery is needed and SSH isn't set up yet: enabling SSH on-device,
  installing a key, direct vs. relayed access.

## Command reference

<!-- BEGIN GENERATED: command-reference -->

### Design

- `npx -y remarkable-axi page [--device <model>] [--landscape] [--css]` — Report the target device's page box, and the CSS to author against it
- `npx -y remarkable-axi render <html> [--out <path>] [--device <model>] [--landscape] [--device-page]` — Print an HTML document to a PDF sized for the target device's page box
- `npx -y remarkable-axi check <file> [--pages <spec>] [--device <model>] [--out <dir>] [--full-res] [--no-images]` — Rasterize a PDF or HTML document at the device's density and lint it against the panel

### Move

- `npx -y remarkable-axi put <src> <dest>` — Send a local PDF/EPUB or a URL to the tablet — source first, destination last
- `npx -y remarkable-axi get <path> [<dest>]` — Bring a document down off the tablet — rendered ink, typed text, or the original file

### Browse

- `npx -y remarkable-axi ls [<path>]` — List the contents of a folder (default: /)
- `npx -y remarkable-axi find <pattern>` — Search every document and folder name by substring or regex
- `npx -y remarkable-axi devices` — Show known reMarkable models with screen specs and PDF page sizes

### Organize

- `npx -y remarkable-axi mkdir <path>` — Create a folder and every missing parent (idempotent)
- `npx -y remarkable-axi mv <path> <dest-dir>` — Move a document or folder into another folder
- `npx -y remarkable-axi rm <path>` — Move a document or folder to the trash

### Setup

- `npx -y remarkable-axi login <code>` — Pair this machine using an 8-character code from my.remarkable.com
- `npx -y remarkable-axi doctor` — Check pairing, connectivity, external tools, duplicate paths, and the cache
- `npx -y remarkable-axi setup device <model>` — Set the device to design for; its specs then appear in every session
- `npx -y remarkable-axi setup hooks` — Install SessionStart hooks so agents see tablet state automatically
- `npx -y remarkable-axi setup ssh <destination> [--via <jump>]` — Configure direct or relayed SSH access to the tablet, for the device command group

### Device

- `npx -y remarkable-axi device status [--ssh <dest>] [--via <jump>]` — Check tablet reachability, xochitl, storage free, and local document count
- `npx -y remarkable-axi device backup <path> [--out <tar>] [--force] [--ssh <dest>] [--via <jump>]` — Tar a document's complete on-device file set to a local archive — the first step of every recovery
- `npx -y remarkable-axi device orphans [<path>] [--render] [--out <dir>] [--ssh <dest>] [--via <jump>]` — List .rm stroke files no page index references — the tablet's own unsynced/clobbered ink

<!-- END GENERATED: command-reference -->

Every command supports `--help` for its full flag reference and examples.

## Notes

- Nothing above is exclusive to this skill — every workflow works from the
  CLI's own `--help` and ambient output with no skill installed. This skill
  adds the recovery judgment and one-time SSH setup that command output alone
  can't teach.
- The `device` command group (`device status`, `device backup`,
  `device reattach`, …) is designed but not yet shipped — the ink-recovery
  playbook uses raw SSH steps only, and will absorb those commands as they
  land without changing what it recovers.
