# DMS Game Dev Tycoon Archipelago Mod — source integration

This is the DMS-authored Game Dev Tycoon Archipelago mod. The owner authorized
private integration and two local smoke clients on 2026-10-04, then MIT licensing
and public first-party source on 2026-10-06, confirming a strictly non-commercial
community project. [NOTICE.md](NOTICE.md) preserves the external distribution
terms. Qualified player releases remain separately gated on standalone and live
DMS/Hub tests.
The repository contains no game assets or third-party mod payloads. See
[the local staging/isolation recipe](qa/README.md) and [LICENSE](LICENSE).

The active DMS candidate is [`dist/main.js`](dist/main.js), supported by the
pure deterministic [`dist/contract.js`](dist/contract.js) module and its
[Game Dev Tycoon mod metadata](dist/package.json). Despite the `dist` directory
name, this remains directly maintained source with no build pipeline. The
original Git blobs and hashes remain recorded in
[SOURCE-MANIFEST.md](SOURCE-MANIFEST.md); the active files are documented
post-snapshot changes rather than silently represented as the originals.

The candidate now removes the UltimateLib hard dependency, pins the historical
`gdt-modAPI` compatibility target to `0.1.2`, binds only fresh saves to a
versioned seed/team/slot contract, uses canonical topic/research objects,
authorizes research without auto-completing it, journals received item indices,
and reports all 43 milestone IDs plus `CLIENT_GOAL`. The exact source-only API is
recorded in [BRIDGE-CONTRACT.md](BRIDGE-CONTRACT.md).

The matching APWorld now uses 66 factual topic IDs and 70 safe research IDs
extracted from the locally installed vanilla 1.7.9 build. The client talks only
to its authenticated AMZ Hub profile over a loopback HTTP bridge. Hub owns AP
WSS authentication, while this mod applies received packs and reports checks.

The old folder also included four complete third-party add-ons. Their payloads
remain excluded because redistribution rights have not been established.
[SOURCE-MANIFEST.md](SOURCE-MANIFEST.md) records exact source and dependency tree
hashes, attribution, and blockers. The [old README](docs/legacy-monorepo-README.md)
is retained byte-for-byte as historical context; its relative links and
installer flow refer to the former monorepo, not to a working installer.

`npm run verify:source` uses only the installed Node runtime. It verifies the
historical Git blobs, parses both active JavaScript files, rejects legacy unsafe
patterns, and runs pure contract tests. It does not install dependencies, build,
package, invoke the bot, or run Game Dev Tycoon.
