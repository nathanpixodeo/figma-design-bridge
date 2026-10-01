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
32-byte random value in `<dataDir>/bridge-token.json`. It is the one control that
separates the Figma plugin's iframe from a hostile page's sandboxed iframe, since
both post from the opaque origin `null`. `npm run bridge:token` prints it;
`npm run bridge:token:rotate` replaces it and unpairs every plugin. The token
must never appear in a log line, a URL, a health response or a commit.

`GET /` and `GET /health` answer without a token so that "is the bridge running?"
stays a cheap question. They return no design content beyond the current page
name and node count, plus the absolute path of the data directory, which can
include your user name. The Host and Origin checks still apply.

## Known weakening you can opt into

`FIGMA_BRIDGE_ALLOW_ANONYMOUS_LEGACY=1` restores the pre-1.1.0 behaviour, where
`/design` and `/snapshots` answered without a token. It exists for scripts that
cannot be updated yet. With it set, any web page open on the machine can read,
overwrite or delete the cached design. The server logs a warning at every
startup while it is set. The Host and Origin checks are not affected by it.

## Out of scope

- Anything requiring an attacker to already have an account on the machine. The
  token file and the snapshot directory are protected by filesystem permissions,
  and on Windows `chmod` is a no-op, so a local user with read access to the data
  directory can read the token by design.
- A Figma access token that you place in your own environment. The bridge sends
  it only to `api.figma.com` and never writes it to disk or to a snapshot.
- The contents of a design you deliberately sync.
