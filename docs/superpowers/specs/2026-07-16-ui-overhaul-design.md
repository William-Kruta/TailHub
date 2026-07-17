# TailHub UI Overhaul — Design

**Date:** 2026-07-16
**Direction:** Refined dark. **Scope:** Reskin + small UX wins. No behavior changes.

## Goals

Make the existing dark UI feel genuinely polished (Linear/Vercel-dashboard quality)
without changing routes, state handling, or the token/login flows. Must remain a
pure static frontend (Linux + macOS, no new dependencies).

## Token system

Rewrite the `:root` layer in `tailhub/static/css/style.css`:

- Deeper blue-black background with a faint ambient radial glow.
- Four surface levels (`--bg`, `--surface`, `--surface2`, `--elevated`) in one hue family.
- Hairline borders via low-opacity white instead of solid gray.
- One purple accent used sparingly (active nav, primary buttons, focus rings);
  cyan only as a tiny highlight (brand icon gradient).
- Type scale 12–28px, Inter with tabular numerals; monospace stack for IPs/latency.
- Shadow scale (sm/md/lg, tinted), radii 10/14px, `:focus-visible` rings on all
  interactive elements.

## Component polish

- **Sidebar:** refined brand row, self-card with gradient hairline border, nav items
  as soft accent pills when active, quieter footer refresh button.
- **Peer cards:** hover lift + border glow, per-peer avatar hue derived from the
  display name, smaller status pill with pulsing dot when online, mono IPs, send
  button ghost-by-default filling accent on hover.
- **Send panel:** segmented control for File/Data modes, drag zone with animated
  dashed border on dragover, slimmer progress bar with shimmer.
- **Inbox:** file-type icon chip, size + relative modified time (API already returns
  `modified`; UI currently drops it), hover-revealed delete, nicer empty state.
- **Modals/toasts/overlays:** backdrop blur, slide/fade micro-animations, toasts
  stacked bottom-right with per-type colored icons, offline/login overlay restyled
  to match.

## Approach

Rewrite the token layer completely, then restyle each section of the existing
stylesheet **keeping all selector names** so no JS-wired states (dragover, hidden,
active, online/offline) are orphaned. Minimal markup/JS changes: template tweaks
plus the inbox timestamp. No CSS framework.

## Verification

Full pytest suite still green, `node --check` on JS, app booted and visually
reviewed by the user.
