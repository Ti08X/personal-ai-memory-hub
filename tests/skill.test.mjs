import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
test('memory Skill helper handles auth, pagination, degradation, conflicts and isolated Worker read/write',{timeout:60000},async()=>{
 await promisify(execFile)('python3',['tests/skill-client.test.py'],{cwd:new URL('..',import.meta.url).pathname,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},maxBuffer:100000});
});
