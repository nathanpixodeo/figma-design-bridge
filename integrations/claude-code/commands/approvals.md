---
description: Show or set whether Figma design reads ask before they run, in every AI client on this machine
argument-hint: "[auto|manual]  (default: show the current mode)"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/figma-bridge.js" approvals "$ARGUMENTS"`

The output above comes from `figma-bridge approvals`, run from this plugin. With
`auto`, the bridge's design reads run without a permission prompt in Claude Code,
Codex, agy and Gemini CLI, wherever they are installed. With `manual`, every
bridge tool asks again. Pairing a Figma plugin and a REST sync always ask.

Report the result in a few lines: the mode, then each client and file it
changed. A client that says the bridge is not set up needs
`figma-bridge setup --only <client>`, or for Claude Code the plugin installed.

If it changed Claude Code's settings, say that sessions started before this one
pick the change up once restarted. If it printed a usage error, the argument was
neither `auto` nor `manual`: show the user the two choices.

This command only reports. Do not edit any settings file yourself.
