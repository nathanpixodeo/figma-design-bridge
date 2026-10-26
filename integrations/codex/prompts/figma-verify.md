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
- `get_design_context` returns the node as Figma's REST JSON, the source for
  exact values: per-corner radii in `rectangleCornerRadii`, mixed text styles
  in `characterStyleOverrides` and `styleOverrideTable`, and tokens in
  `boundVariables`, named in its `variables` map. A hard-coded value where the
  design binds a variable is a finding: it will not follow the token. If the
  notes say Design Bridge is too old to export REST JSON, ask the user to
  reopen Design Bridge before reporting a radius or a text style as missing.
- Prefer a link to one screen frame: a section or group holding many screens is
  slow to read and can run the Figma plugin out of memory. Pass
  `includeHidden: false` unless hidden layers matter.
- When a result carries a truncation note, raise `depth`, `maxNodes` or
  `maxBytes`, or read a child node, before reporting anything as missing.
- If a read fails with `SESSION_LOST`, ask the user to reopen Design Bridge,
  then read a smaller node.
- Call `get_design_image` on the node link: the rendered truth for layout and
  visual weight. Render each section by its own link to compare small details.
- Call `get_design_assets` on the node link for every icon as Figma's own SVG
  and every image as its file, with the layers that use them.
- If either fails with `PLUGIN_OUTDATED`, ask the user to close and reopen
  Design Bridge in Figma.

If no render is available, mark every layout and visual-weight check as **not verified** rather than passed.

If nothing is loaded, stop and say which data directory the server reported. Two things put data there: the Figma plugin's **Sync Full Page** or **Sync Selected Nodes**, or `sync_figma_design` with a Figma URL, which needs `FIGMA_ACCESS_TOKEN`. Do not review the code against assumptions about the design.

## 2. Read the implementation

Read every path in the arguments in full. Follow imports far enough to resolve what actually renders: the stylesheet or style object, the theme or token file, shared primitives, and any variant or state logic. A value that comes from a theme file is only correct if that theme entry is correct.

## 3. Compare on seven axes

1. **Text and copy** — exact strings, casing, punctuation, truncation, pluralisation, and empty states.
2. **Colour** — fills, strokes, shadows, and overlays, compared as resolved values, with opacity noted separately.
3. **Typography** — family, size, weight, line height, letter spacing, and text transform.
4. **Spacing and size** — padding, gap, margin, width and height constraints, border radius, and border width.
5. **State** — hover, focus, active, disabled, loading, error, and selected.
6. **Responsive behaviour** — how the design's constraints map to the code's breakpoints, wrapping, and overflow.
7. **Icons and images** — each icon against the SVG `get_design_assets` exported for it: viewBox, rendered size, fill and stroke colors, stroke width and shape. An icon drawn by hand, rebuilt from vector paths or taken from an icon library instead of the exported SVG is a **Major** finding, even when it looks close. Each image uses the exported file, at the layer's size, scale mode (FILL is `object-fit: cover`, FIT is `contain`) and corner radius.

Also flag accessibility gaps the design implies but the code drops: focus visibility, contrast against the actual background, alt text, and semantic element choice.

## 4. Report

A table, most severe first, with `file:line` and both values quoted on every row:

| Severity | Axis | Design | Code | Where |
| --- | --- | --- | --- | --- |

**Blocker** is wrong information shown to the user, a missing state, or an accessibility failure. **Major** is a visible mismatch a designer would reject. **Minor** is a rounding-level difference.

After the table, list any place where the design itself is ambiguous or missing a state — those are decisions for the designer, not defects in the code. Close with a one-line verdict and the smallest set of changes that would make the code match.
