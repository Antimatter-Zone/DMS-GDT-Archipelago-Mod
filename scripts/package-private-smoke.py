"""Build a reproducible DMS-only private QA artifact, never licensed game files."""
from __future__ import annotations

import argparse
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import zipfile


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    payload = {
        **{f"mods/DMSArchipelago/{name}": root / "dist" / name for name in ("package.json", "main.js", "contract.js", "bridge.js")},
        **{f"qa/{name}": root / "qa" / name for name in ("smoke-bootstrap.js", "smoke-storage.js")},
    }
    files = [{"path": name, "sizeBytes": file.stat().st_size, "sha256": sha256(file.read_bytes()).hexdigest()}
             for name, file in sorted(payload.items())]
    source_tree = sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    args.output.mkdir(parents=True, exist_ok=True)
    archive = args.output / "client.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=False) as package:
        for name, file in sorted(payload.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 4, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            package.writestr(info, file.read_bytes())
    manifest = {
        "schemaVersion": 1,
        "packId": "dms-gdt-archipelago-client",
        "version": json.loads((root / "dist" / "package.json").read_text())["version"],
        "gameType": "game-dev-tycoon", "privateSmoke": True,
        "gameVersion": "1.7.9", "steamBuild": "20332874",
        "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
        "sourceState": "working-tree" if subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=root, text=True).strip() else "commit",
        "sourceTreeSha256": source_tree,
        "archiveSha256": sha256(archive.read_bytes()).hexdigest(),
        "archiveSizeBytes": archive.stat().st_size,
        "files": files,
    }
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: manifest[key] for key in ("version", "archiveSha256", "archiveSizeBytes", "sourceTreeSha256")}))


if __name__ == "__main__":
    main()
