# DMS Game Dev Tycoon Archipelago Mod — local source candidate

This is a fresh, **local-only and source-only candidate** for the DMS-authored Game Dev Tycoon Archipelago mod. It has no remote and is not approved for dependency installation, build, packaging, distribution, or deployment. The catalog calls the mod active, but this checkout is not release-ready.

The preserved DMS mod code is [`dist/main.js`](dist/main.js) with its original [Game Dev Tycoon mod metadata](dist/package.json). Despite the `dist` directory name, old Git history shows direct, readable edits to this JavaScript and no separate `src` tree or build pipeline; it is the only DMS-maintained source found in the old mod folder. Its `gdt-modAPI` and `UltimateLib` dependencies are **not** bundled here.

The old folder also included four complete third-party add-ons. Their payloads were deliberately excluded because redistribution rights have not been established; [SOURCE-MANIFEST.md](SOURCE-MANIFEST.md) records exact source and dependency tree hashes, attribution, and blockers. The [old README](docs/legacy-monorepo-README.md) is retained byte-for-byte as historical context; its relative links and installer flow refer to the former monorepo, not to a working installer in this candidate.
