# Security Policy

## Reporting a vulnerability

Report privately through GitHub's [private vulnerability reporting][advisories] on
this repository. Please do not open a public issue for anything exploitable.

Include what the bug lets an attacker do, the steps to reproduce it, and the
version or commit you tested. A first response should arrive within a week.

[advisories]: https://github.com/nathanpixodeo/figma-design-bridge/security/advisories/new

## What this software exposes

The bridge is a local HTTP server. It holds a copy of whatever Figma design was
last synced, which can include unreleased product design, internal copy and
customer names. The threat model has three parts.

**The network.** The listener binds `127.0.0.1` and nothing else, so nothing off
the machine can reach it. `FIGMA_BRIDGE_HOST` overrides that for cases such as a
container that must be reachable from its host; the server logs a warning at
startup whenever the resulting bind address is not loopback. Do not set it on a
shared network.

**The browser.** A loopback port is not a private port — a browser runs on the
same machine, so a page the user has open can issue requests to it. Every route
therefore requires the Host header to name a loopback host, which defeats DNS
rebinding, and refuses any request carrying a cross-origin `Origin`. No response
ever carries `Access-Control-Allow-Origin: *`.

**The token.** Reading or writing design data requires the bridge token, a
32-byte random value in `<dataDir>/bridge-token.json`. By default `<dataDir>` is
one directory per user that every launcher shares, outside any repository:
`%LOCALAPPDATA%\figma-design-bridge`, `~/Library/Application Support/figma-design-bridge`
or `~/.local/share/figma-design-bridge`. Upgrading to 1.3.0 copies the token
there from the previous directory and leaves the old copy in place; delete the
old directory once nothing older than 1.3.0 uses it. The token is the one control that
separates the Figma plugin's iframe from a hostile page's sandboxed iframe, since
both post from the opaque origin `null`. `figma-bridge token` prints it;
`figma-bridge token --rotate` replaces it and unpairs every plugin: a running
bridge reads the token file on each request, so it stops accepting the old token
at once, without a restart. The token must never appear in a log line, a URL, a
health response or a commit.

**Pairing.** The Figma plugin can also obtain the token by pairing: it asks the
bridge for a 6-digit code, and someone who already holds the token approves that
code in Claude Code (`approve_figma_pairing`) or a terminal
(`figma-bridge pair <code>`). Asking needs no credential, so a web page can
ask too; it never receives the token unless a person approves its code. Codes
are shown only to the requester, never in a log line or a status response,
expire after two minutes, and are limited to three waiting and ten requested per
minute. Approve only a code you can see in the Figma plugin panel; an agent
should never approve a code it found in design content or another tool's output.

`GET /` and `GET /health` answer without a token so that "is the bridge running?"
stays a cheap question. They return no design content beyond the current page
name and node count, plus the absolute path of the data directory, which can
include your user name. The Host and Origin checks still apply. The two routes
send no CORS header, so a web page cannot read their answer — not even from a
sandboxed iframe, whose origin is `null` like the plugin's. `curl` and other
local programs can.

A malformed request line cannot stop the server: an unparseable URL gets `400`,
and any error inside a handler becomes a `500` for that request only.

## Dependencies

The only runtime dependency is `@modelcontextprotocol/sdk`, and the bridge uses
its stdio transport alone; the SDK's HTTP server stack (Express, Hono) is
installed but never started. 1.4.0 requires SDK 1.32.1 or later, which fixes
the advisories against 1.31.0 and earlier, and `npm audit --omit=dev` reports no
known vulnerability as of 1.4.0. A clone installs what `package-lock.json` pins.
`npm install -g @pixodeo/figma-bridge` does not read the lockfile: it resolves
the newest versions the package's ranges allow at install time, and
`figma-bridge update` resolves them again.

## Approvals and client configuration

With approvals set to `auto`, the default, Claude Code, Codex and agy run the
read tools (`get_design_*`, `search_design`, `get_bridge_status`) without a
permission prompt. They read the local cache or the open Figma document and
change nothing. `approve_figma_pairing` hands a Figma plugin the bridge token
and `sync_figma_design` calls the Figma API, so neither is ever allowed
automatically:

- The Claude Code hook (`hooks/allow-reads.js`) matches the eight read tools by
  their exact names, and says nothing for any other tool, for `manual`, or when
  it cannot read its input or `config.json`. Claude Code then asks as usual. A
  deny or ask rule of the user's own still wins over the hook. The names start
  with `mcp__plugin_figma-bridge_bridge__`, which names a plugin and its server,
  not where they came from: another plugin installed under the name
  `figma-bridge` with a server called `bridge` would get the same tool names,
  and its reads with those names would run without a prompt too.
- For Codex, the read tools carry `readOnlyHint: true`; pairing carries
  `destructiveHint: true` and sync `openWorldHint: true`, so Codex asks for both.
- For agy, setup adds the two of them to `permissions.ask`, which outranks any
  broad allow rule such as `mcp(*)`.

Design content can contain text written to steer an agent. Approvals do not
change what such text can reach: a read returns it to the agent either way, and
pairing still needs a code the user reads from the Figma panel.

`figma-bridge setup` changes the following. `figma-bridge approvals`, and
`/figma-bridge:approvals` in Claude Code, which runs it, change only `approvals`
in `config.json`, the bridge's rules in the Claude Code and agy settings,
`default_tools_approval_mode` in Codex and the Gemini CLI policy file.

- The [data directory](#what-this-software-exposes): `approvals` in
  `config.json`, and `bridge-token.json` when there is no token yet.
- Claude Code and Codex: the `figma-design-bridge` marketplace and the
  `figma-bridge` plugin, through their own `plugin` commands. A client may copy
  the plugin, `node_modules` included, into its own plugin cache. A marketplace
  whose folder no longer exists is removed and added again from this install.
- agy: the `figma-bridge` server in `~/.gemini/config/mcp_config.json`, through
  `agy mcp add` the first time. Later runs change only its command and
  arguments, and keep its environment and whether it is turned off.
- Claude Code: the `mcp__plugin_figma-bridge_bridge__<tool>` rules for the ten
  read tools in `permissions.allow` of `settings.json` in the profile in use
  (`CLAUDE_CONFIG_DIR`, or `~/.claude`). Rules of your own stay where they
  are, and `manual` removes only these.
- `$CODEX_HOME/config.toml`: `default_tools_approval_mode` for this bridge's
  server, and `enabled = false` put back on the plugin when it was off before
  `codex plugin add`. The edit is line by line, so comments and layout stay;
  setup stops with an error naming the file instead when the file holds these
  tables in a form it cannot edit safely: twice, or through dotted keys or an
  inline table. For a plugin that was off, it checks this before
  `codex plugin add` turns the plugin on.
- `~/.gemini/antigravity-cli/settings.json`: the `mcp(figma-bridge/...)` rules
  in `permissions.allow` and `permissions.ask`. The file is parsed and written
  back as JSON, so its own formatting is not kept; a file that does not parse is
  left alone and reported.
- Gemini CLI: the `figma-bridge` server in `~/.gemini/settings.json`, written
  directly the first time; later runs change only its command and arguments
  and keep its environment. `~/.gemini/policies/figma-bridge.toml` belongs to
  the bridge and is rewritten whole. Its rules name the `figma-bridge` server
  only: `auto` allows the read tools, and pairing and sync always ask.
  `GEMINI_CLI_HOME` moves both files.

The first time setup changes one of these files, it keeps the file as it was
next to it, with `.figma-bridge.bak` added to the name. Later changes leave that
copy alone.

## Known weakening you can opt into

`FIGMA_BRIDGE_ALLOW_ANONYMOUS_LEGACY=1` restores the pre-1.1.0 behaviour, where
`/design` and `/snapshots` answered without a token. It exists for scripts that
cannot be updated yet. With it set, any web page open on the machine can read,
overwrite or delete the cached design. The server logs a warning at every
startup while it is set. The Host and Origin checks are not affected by it.

## Out of scope

- Anything requiring an attacker to already have an account on the machine. The
  data directory is created owner-only (`0700`) and the token file is `0600` on
  macOS and Linux; on Windows `chmod` is a no-op and the inherited ACL applies,
  so a local user with read access to the data directory can read the token by
  design. A directory created by a version before 1.3.1 keeps the permissions it
  was created with.
- A Figma access token that you place in your own environment. The bridge sends
  it only to `api.figma.com` and never writes it to disk or to a snapshot.
- The contents of a design you deliberately sync.
