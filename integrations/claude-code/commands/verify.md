---
description: Compare front-end code against a Figma design and report every mismatch
argument-hint: <figma-node-url-or-search-term> <path/to/component> [more paths...]
---

Compare the implemented front-end code against the design and report the differences. Arguments: `$ARGUMENTS` — the first is a Figma node URL, node id, or a layer name to search for; the rest are the code paths that implement it.

This command reports. It does not edit code. Stop after the report unless the user asks for the fixes to be applied.

## 1. Establish the design as the source of truth

Prefer the official Figma MCP server when it is connected, because it is the only source here that returns a rendered image:

- `get_screenshot` on the node — the rendered truth, needed for anything about layout or visual weight.
- `get_design_context` on the node — structure, computed styles, and any Code Connect mapping.
- `get_variable_defs` on the node — design tokens. A hard-coded value in the code that matches a token's *value* is still a finding: it will not follow the token when the token changes.

Otherwise use this plugin's bridge tools: call `get_bridge_status` first for
setup diagnostics. If the first argument is a Figma node link (it contains
`node-id`), call `get_design_context` with it as `source`, then pass the same
`source` to `search_design`, `get_design_texts`, and `get_design_colors`.
`get_design_context` returns the node as Figma's REST JSON, the source for exact
values: per-corner radii in `rectangleCornerRadii`, mixed text styles in
`characterStyleOverrides` and `styleOverrideTable`, and tokens in
`boundVariables`, named in its `variables` map. A hard-coded value where the
design binds a variable is a finding, as above. If its notes say Design Bridge
is too old to export REST JSON, ask the user to reopen Design Bridge before
reporting a radius or a text style as missing. A file
link or a bare file key returns only the document index — pages and their
top-level frames — and those three tools refuse it: use the index to find the
frame, then ask the user for that frame's link (in Figma, right-click the frame
and choose Copy link to selection). Prefer a link to one screen frame: a section
or group holding many screens is slow to read and can run the Figma plugin out
of memory. Pass `includeHidden: false` unless hidden layers matter. When a
result carries a truncation note, raise `depth`, `maxNodes` or `maxBytes`, or
read a child node, before reporting anything as missing. If a read fails with
`SESSION_LOST`, ask the user to reopen Design Bridge, then read a smaller node. Only use unscoped `get_design_info` and omit `source` when
checking the legacy imported snapshot. Say in the report that the bridge was used, and mark every layout and
visual-weight check as **not verified** rather than passed — the bridge exposes
no image, so those checks cannot be performed from it.

If neither source is reachable, stop and say which one failed and how to restore it. Do not review the code against assumptions about the design.

## 2. Read the implementation

Read every path in the arguments in full. Follow imports far enough to resolve what actually renders: the stylesheet or style object, the theme or token file, shared primitives, and any variant or state logic. A value that comes from a theme file is only correct if that theme entry is correct.

## 3. Compare on six axes

For each axis, check the code against the design and record concrete values on both sides.

1. **Text and copy** — exact strings, casing, punctuation, truncation, pluralisation, and empty states. A trailing period or a different dash is a real finding.
2. **Colour** — fills, strokes, shadows, and overlays, compared as resolved values. Note opacity applied separately from the colour.
3. **Typography** — family, size, weight, line height, letter spacing, and text transform.
4. **Spacing and size** — padding, gap, margin, width and height constraints, border radius, and border width.
5. **State** — hover, focus, active, disabled, loading, error, and selected. Designs often carry these on separate frames; look for them before concluding a state is undesigned.
6. **Responsive behaviour** — how the design's constraints or auto-layout map to the code's breakpoints, wrapping, and overflow.

Also flag accessibility gaps that the design implies but the code drops: focus visibility, contrast against the actual background, alt text, and semantic element choice.

## 4. Report

Produce a table, most severe first:

| Severity | Axis | Design | Code | Where |
| --- | --- | --- | --- | --- |

- **Blocker** — wrong information shown to the user, a missing state, or an accessibility failure.
- **Major** — visible mismatch a designer would reject on review.
- **Minor** — sub-pixel or rounding-level difference.

Every row cites `file:line` and quotes both values. After the table, list any place where the design itself is ambiguous or missing a state, because those are decisions for the designer rather than defects in the code.

Close with a one-line verdict: whether the implementation matches the design, and what the smallest set of changes would be to make it match.
