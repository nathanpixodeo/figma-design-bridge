---
description: Compare front-end code against a Figma design and report every mismatch
argument-hint: <figma-node-url-or-search-term> <path/to/component> [more paths...]
---

Compare the implemented front-end code against the design and report the differences. The first argument is a Figma node URL, node id, or a layer name to search for; the rest are the code paths that implement it: $ARGUMENTS

Report only. Do not edit code. Stop after the report unless asked to apply the fixes.

## 1. Establish the design as the source of truth

Use the `figma-bridge` MCP server:

- `get_bridge_status` first, to confirm the local bridge is ready.
- If the first argument is a Figma node link (it contains `node-id`), call
  `get_design_context` with that value as `source`; otherwise call
  `get_design_info` for the legacy imported snapshot.
- Call `search_design`, `get_design_texts`, and `get_design_colors` with the
  same `source`. A file link or bare file key returns only the document index
  (pages and their top-level frames) and those tools refuse it: find the frame
  in the index, then ask for that frame's link (in Figma: right-click, Copy link
  to selection).
- Prefer a link to one screen frame: a section or group holding many screens is
  slow to read and can run the Figma plugin out of memory. Pass
  `includeHidden: false` unless hidden layers matter.
- When a result carries a truncation note, raise `depth`, `maxNodes` or
  `maxBytes`, or read a child node, before reporting anything as missing.
- If a read fails with `SESSION_LOST`, ask the user to reopen Design Bridge,
  then read a smaller node.

The bridge exposes no rendered image. Mark every layout and visual-weight check as **not verified** rather than passed, because they cannot be performed from structural data alone. If another connected server can return a screenshot of the node, use it and say so.

If nothing is loaded, stop and say which data directory the server reported. Two things put data there: the Figma plugin's **Sync Full Page** or **Sync Selected Nodes**, or `sync_figma_design` with a Figma URL, which needs `FIGMA_ACCESS_TOKEN`. Do not review the code against assumptions about the design.

## 2. Read the implementation

Read every path in the arguments in full. Follow imports far enough to resolve what actually renders: the stylesheet or style object, the theme or token file, shared primitives, and any variant or state logic. A value that comes from a theme file is only correct if that theme entry is correct.

## 3. Compare on six axes

1. **Text and copy** — exact strings, casing, punctuation, truncation, pluralisation, and empty states.
2. **Colour** — fills, strokes, shadows, and overlays, compared as resolved values, with opacity noted separately.
3. **Typography** — family, size, weight, line height, letter spacing, and text transform.
4. **Spacing and size** — padding, gap, margin, width and height constraints, border radius, and border width.
5. **State** — hover, focus, active, disabled, loading, error, and selected.
6. **Responsive behaviour** — how the design's constraints map to the code's breakpoints, wrapping, and overflow.

Also flag accessibility gaps the design implies but the code drops: focus visibility, contrast against the actual background, alt text, and semantic element choice.

## 4. Report

A table, most severe first, with `file:line` and both values quoted on every row:

| Severity | Axis | Design | Code | Where |
| --- | --- | --- | --- | --- |

**Blocker** is wrong information shown to the user, a missing state, or an accessibility failure. **Major** is a visible mismatch a designer would reject. **Minor** is a rounding-level difference.

After the table, list any place where the design itself is ambiguous or missing a state — those are decisions for the designer, not defects in the code. Close with a one-line verdict and the smallest set of changes that would make the code match.
