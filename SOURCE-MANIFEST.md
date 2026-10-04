# Source, dependency, and rights manifest

## Provenance and boundary

- Source integration commit: `e609a8d38fca5e5a3f259aa6e158f5a1d2ceda7a`.
- Old monorepo path: `applications/services/discord-bot/games/archipelago/mod`.
- DMS code path: `dist` (source Git tree `88bbd639417cad6ac2b16618acad871a0961c8a1`). At extraction, only `dist/main.js` and `dist/package.json` were copied into the candidate with unchanged Git blob content; the post-snapshot section below records later active-source edits.
- `dist/main.js` SHA-256: `7fb4abc1a8fc032a75864522656bfb6f669e51349fdc40ec173891a10c3b20f4`.
- `dist/package.json` SHA-256: `1cc6594e847e9182e96a085261fae5b5f78ca7c7176f8140960501859893722b`.
- Old `README.md` is preserved byte-for-byte at `docs/legacy-monorepo-README.md` (SHA-256 `197fbd0dd25964b286a635e615e0ea5e2b807fd7ef7280ed9edd14cc841bf534`). Its relative links target the old monorepo and are historical.
- Old Git history introduced this DMS mod on 2026-02-15 (`3dbe6fed`) and directly edited `dist/main.js` in later commits `acd184be` and `68da7e13`; `2bdd7a01` moved the path. There is no separate `src` tree, source map, bundler config, or build script in the old mod folder. The JavaScript is readable and directly maintained, not a minified binary bundle.
- The original package names DarkMatterServers as author, but no standalone DMS mod license was found. Confirm ownership/desired license before any remote or distribution.

## Post-snapshot source changes

The SHA-256 values above intentionally continue to identify the original
snapshot. They were not rewritten after development resumed. Git retains the
original blobs as `5f352a08b8e238a01f279e49c576d217117b8eea`
(`main.js`) and `9bfa92bc5c862fd54e809af25eca050a394e6595`
(`package.json`), and the read-only verifier checks them directly.

The active source-only candidate is version `0.2.0-source`. It adds a pure
contract module and static tests, removes local randomization and the UltimateLib
runtime gate, pins `gdt-modAPI` to the reviewed historical snapshot version
`0.1.2`, and implements fresh-save identity binding, deterministic pack
consumption, canonical-object reconciliation, native research availability,
received-index journaling, milestone checks, and goal reporting. See
[BRIDGE-CONTRACT.md](./BRIDGE-CONTRACT.md) for the proposed bridge interface.

These are post-snapshot DMS edits and do not resolve any ownership or
distribution gate.

### Authorized private integration, 2026-10-04

The owner's request to run two real smoke clients authorizes local installation
and runtime testing with the owned target game. Active version `0.2.0-smoke.1`
adds a loopback-only Node HTTP bridge transport and local QA prebootstrap. The
prebootstrap isolates native save reads/writes and suppresses smoke achievement
writes before game startup; it preserves native Steam initialization. Only DMS
scripts are packaged. Game assets and `gdt-modAPI` come from the user's local
licensed install and remain local. Public redistribution gates remain separate.

## Third-party add-ons excluded

The old folder's 42 MB of add-on payloads were not copied. These are dependencies or other complete mods, not DMS-owned source and not candidates for unrelated GitHub forks.

| Old `addons/` folder | Attribution and snapshot version | Source Git tree | Rights note |
| --- | --- | --- | --- |
| `gdt-modAPI` | Greenheart Games, 0.1.2 | `01896402dfd5a05fbed8136a1d97a602e68147b2` | Bundled `LICENSE` points to the [official modding agreement](https://www.greenheartgames.com/legal/game-dev-tycoon-modding-agreement/); downstream use must comply. |
| `UltimateLib` | Francesco Abbattista and Chad Keating, 1.4.0 | `41eb0ff1f33b40a27d13f4830d2ca54a7e8a606f` | Its bundled `License.txt` expressly restricts copying/publishing and bundling with another add-in without permission. Do not redistribute it here. |
| `GDTExpansionPack` | Linshi, 1.4.0 | `0dea159495181b891cf4bc86de21027e3b32c8f8` | No package-level redistribution license found in the source snapshot. |
| `TAG_Mod` | Bellwood Studios, 1.2.7 | `adfc1c1762b82bbd6dcd38a4a1779ac09369e41d` | No package-level redistribution license found; this full UI mod carries many assets/fonts. |

The original DMS package specified `gdt-modAPI: 0.1.x` and
`UltimateLib: 1.x.x`; those historical floating ranges were not acceptable.
The active source candidate specifies only exact `gdt-modAPI` `0.1.2` and does
not require or redistribute UltimateLib. The other two add-ons are not named as
DMS package dependencies. The old tree also contained a generated `Thumbs.db`
inside UltimateLib, which remains excluded with the add-on payloads.

## Release blockers and verification limits

This checkout cannot reconstruct or validate the old installer or runtime by
itself. Before any remote, release, or bot download flow, establish a standalone
DMS license/owner approval; verify the
[Game Dev Tycoon modding agreement](https://www.greenheartgames.com/legal/game-dev-tycoon-modding-agreement/)
for this use (including its commercial-use and original-game-asset
restrictions); obtain any third-party permissions needed for actual packaging;
provide and review the canonical vanilla 1.7.9 content fixture; prove the native
fan adjustment and research hooks against the licensed game; pin and sign every
input; and design a dependency/install recipe that does not re-bundle prohibited
add-ons. No build, install, packaging, live bot call, or runtime game test is
claimed by the post-snapshot static verification.
