---
description: Show what design is currently loaded in the bridge cache
argument-hint: "[summary|tree|texts|colors]  (default: info)"
---

Report the state of the local design cache. Argument: `$ARGUMENTS` — which view to show, defaulting to the short one.

Always start with `get_bridge_status`, then call `get_design_info`. The status
tool reports bridge readiness and setup hints without exposing pairing secrets;
the info tool reports the page name, node count, sync timestamp, and data
directory actually in use.

Then, depending on the argument:

- no argument or `info` — stop after `get_design_info`.
- `summary` — `get_design_summary`.
- `tree` — `get_design_tree`.
- `texts` — `get_design_texts`.
- `colors` — `get_design_colors`.

If the tools report that no design is loaded, do not guess at why. Say which data directory the server reported and list the two things that put data there: calling `sync_figma_design` with a Figma URL, which needs `FIGMA_ACCESS_TOKEN` in the server's environment, or running `figma-bridge import <figma-url>`. The Figma plugin does not fill this cache: with its panel open and paired, read the file live instead by passing a Figma node link as `source` to `get_design_context` or the other design tools.

A stale `syncedAt` is worth calling out on its own. Design data that is hours or days old will produce a confident and wrong answer in any comparison built on it, so say how old it is rather than only that it loaded.
