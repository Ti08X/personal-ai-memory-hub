#!/usr/bin/env python3
"""Build a deterministic, credential-free Skill archive from an explicit file list."""
import hashlib
import json
from pathlib import Path
import re
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NAME = "personal-ai-memory-hub"
SOURCE = ROOT / "integrations" / "skills" / NAME
FILES = ["SKILL.md", "agents/openai.yaml", "references/api.md", "references/setup.md", "scripts/hub_client.py"]
TARGET = ROOT / "public" / (NAME + "-skill.zip")
manifest = []
with tempfile.TemporaryDirectory(prefix="pmh-skill-build-") as scratch:
    staging = Path(scratch) / TARGET.name
    with zipfile.ZipFile(staging, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in FILES:
            path = SOURCE / name
            if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(SOURCE.resolve()):
                raise ValueError("Only explicit contained regular Skill sources may be packaged")
            raw = path.read_bytes()
            text = raw.decode("utf-8")
            if re.search(r"pmh_[a-fA-F0-9]{64}|sk-[A-Za-z0-9_-]{24,}|-----BEGIN .*PRIVATE KEY-----", text):
                raise ValueError("Credential-like source rejected")
            item = zipfile.ZipInfo(NAME + "/" + name, date_time=(2026, 10, 14, 0, 0, 0))
            item.compress_type = zipfile.ZIP_DEFLATED
            item.external_attr = 0o100644 << 16
            archive.writestr(item, raw)
            manifest.append({"path": item.filename, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
    # Atomic replacement on the target filesystem, even if /tmp is another volume.
    pending = TARGET.with_suffix(".zip.pending")
    try:
        pending.write_bytes(staging.read_bytes())
        pending.replace(TARGET)
    finally:
        pending.unlink(missing_ok=True)
digest = hashlib.sha256(TARGET.read_bytes()).hexdigest()
TARGET.with_suffix(".sha256").write_text(digest + "  " + TARGET.name + "\n")
(ROOT / "docs" / "memory-skill-manifest.json").write_text(json.dumps({"name": NAME, "archive": TARGET.name, "sha256": digest, "files": manifest}, indent=2) + "\n")
print(json.dumps({"archive": TARGET.name, "files": len(manifest), "sha256": digest}))
