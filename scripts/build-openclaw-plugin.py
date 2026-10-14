#!/usr/bin/env python3
"""Deterministic npm-compatible tarball; only explicitly named public source files."""
import gzip, hashlib, io, json, re, tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'integrations/openclaw-memory'
FILES=['package.json','openclaw.plugin.json','index.js','runtime.mjs','core.mjs','README.md']
TARGET=ROOT/'public/openclaw-personal-memory-hub.tgz'
items=[]
stream=io.BytesIO()
with gzip.GzipFile(fileobj=stream,mode='wb',mtime=0,filename='') as zipped:
    with tarfile.open(fileobj=zipped,mode='w') as archive:
        for name in FILES:
            p=SOURCE/name
            if p.is_symlink() or not p.is_file() or not p.resolve().is_relative_to(SOURCE.resolve()):raise ValueError('Unexpected plugin source')
            raw=p.read_bytes()
            if re.search(rb'pmh_[a-fA-F0-9]{64}|sk-[A-Za-z0-9_-]{24,}|-----BEGIN .*PRIVATE KEY-----',raw):raise ValueError('Credential-like source rejected')
            info=tarfile.TarInfo('package/'+name);info.size=len(raw);info.mode=0o644;info.mtime=0
            archive.addfile(info,io.BytesIO(raw));items.append({'path':info.name,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)})
pending=TARGET.with_suffix('.pending');pending.write_bytes(stream.getvalue());pending.replace(TARGET)
digest=hashlib.sha256(TARGET.read_bytes()).hexdigest()
(ROOT/'public/openclaw-personal-memory-hub.sha256').write_text(digest+'  '+TARGET.name+'\n')
(ROOT/'public/openclaw-memory-setup.md').write_bytes((SOURCE/'README.md').read_bytes())
(ROOT/'docs/openclaw-plugin-manifest.json').write_text(json.dumps({'version':'0.1.0','sha256':digest,'files':items},indent=2)+'\n')
print(json.dumps({'archive':TARGET.name,'sha256':digest,'files':len(items)}))
