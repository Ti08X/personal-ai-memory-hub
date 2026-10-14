import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openClawConfig,openClawInstructions,accessLevels} from '../public/client-access.js';

test('OpenClaw configuration uses explicit HTTP transport and credentials only in the auth header',()=>{
 const key='synthetic-test-only',config=openClawConfig('https://hub.example',key).mcp.servers.personal_memory_hub;
 assert.equal(config.url,'https://hub.example/mcp');assert.equal(config.transport,'streamable-http');assert.equal(config.headers.Authorization,'Bearer '+key);assert.equal(config.auth,undefined);
 assert.ok(!config.url.includes(key));assert.equal(accessLevels[3].range,'L0–L3');
 const instructions=openClawInstructions('https://hub.example');
 assert.ok(!instructions.includes(key));assert.ok(instructions.includes('expected_version'));assert.ok(instructions.includes('partial'));assert.ok(instructions.includes('degraded'));
});

test('published REST helper rejects unsafe URLs, redirects and unauthorised writes without printing a Key',async()=>{
 const python=String.raw`
import importlib.util, argparse, urllib.request, io, contextlib, os
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('helper','public/memory-hub-client.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
key='pmh_'+'a'*64
def args(base='https://hub.example/v1',command='search'):
 return argparse.Namespace(base_url=base,command=command,query='近期目标',mode='hybrid',limit=10,record_id='rec_123')
r=m.build_request(args(),key)
assert r.full_url.startswith('https://hub.example/v1/search?')
assert r.get_header('Authorization')=='Bearer '+key
assert key not in r.full_url
for base in ['http://hub.example','https://user:pass@hub.example','https://hub.example?key=x','https://hub.example/mcp','https://hub.example/#x']:
 try: m.build_request(args(base),key);raise AssertionError('unsafe base accepted')
 except ValueError: pass
for body in [None,{'authorized':False},{'text':'no consent'}]:
 try: m.build_request(args(command='save'),key,body);raise AssertionError('unauthorized write accepted')
 except ValueError: pass
assert m.build_request(args(command='import'),key,{'authorized':True,'messages':[]}).method=='POST'
assert m.NoRedirect().redirect_request(r,None,302,'redirect',{},'https://other.example') is None
with patch.dict(os.environ,{'PMH_API_KEY':key}),patch.object(m.urllib.request,'build_opener') as opener:
 opener.return_value.open.side_effect=urllib.error.HTTPError(r.full_url,403,'denied',{},None)
 output=io.StringIO()
 with contextlib.redirect_stderr(output): assert m.main(['handoff'])==1
 assert 'HTTP 403' in output.getvalue() and key not in output.getvalue()
`;
 await promisify(execFile)('python3',['-c',python],{cwd:new URL('..',import.meta.url).pathname,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 const guide=await readFile(new URL('../public/openclaw-quickstart.md',import.meta.url),'utf8');
 assert.ok(guide.includes('memory-hub-client.py'));assert.ok(guide.includes('不会'));assert.ok(!/pmh_[a-f0-9]{64}/.test(guide));
});
