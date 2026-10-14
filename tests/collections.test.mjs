import test from 'node:test';
import assert from 'node:assert/strict';
import {accountRecord,knowledgeRecords,publicUrl} from '../public/collections.js';
test('knowledge import reconstructs Unicode original text and stable citation ranges without truncation',async()=>{
 const text='开始\n'+'🚀𠮷记忆'.repeat(2300)+'\n结束',first=await knowledgeRecords(text,'test.md'),again=await knowledgeRecords(text,'test.md');
 assert.equal(first.map(r=>r.text).join(''),text);assert.deepEqual(first,again);assert.ok(first.length>1);assert.ok(first.every(r=>r.text.length<=8000));
 for(let i=0;i<first.length;i++){const d=first[i].data;assert.equal(d.start_offset,i*4000);assert.equal(d.chunk_count,first.length);assert.equal(Array.from(text).slice(d.start_offset,d.end_offset).join(''),first[i].text);assert.equal(d.line_start,1+(Array.from(text).slice(0,d.start_offset).join('').match(/\n/g)||[]).length);}
 assert.notEqual((await knowledgeRecords(text+'变更','test.md'))[0].session_id,first[0].session_id);
 await assert.rejects(()=>knowledgeRecords('binary\0file','test.txt'));await assert.rejects(()=>knowledgeRecords('hello','file.pdf'));await assert.rejects(()=>knowledgeRecords('x'.repeat(256*1024+1),'large.txt'));
});
test('social account identity normalizes public URLs and rejects credential-bearing links',async()=>{
 const a={platform:'X',handle:'@example',display_name:'Example',url:'https://x.com/example/',purpose:'合成账号',notes:'',status:'active'};
 const first=await accountRecord(a),same=await accountRecord({...a,url:'https://x.com/example',notes:'新版备注'});assert.equal(first.logical_key,same.logical_key);assert.equal(first.data.url,'https://x.com/example');assert.equal(first.record_type,'profile');
 for(const url of ['javascript:alert(1)','http://example.com','https://user:secret@example.com','https://example.com?token=secret'])assert.throws(()=>publicUrl(url));
 await assert.rejects(()=>accountRecord({...a,platform:''}));
});
