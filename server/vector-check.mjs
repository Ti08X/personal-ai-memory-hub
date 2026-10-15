import assert from 'node:assert/strict';
import {Vectors} from './vectors.mjs';
const index=new Vectors(process.env.QDRANT_URL??'http://127.0.0.1:6333','acceptance_'+Date.now(),process.env.QDRANT_API_KEY);
const vector=Array.from({length:1024},(_,i)=>i===0?1:0);
try{
 await index.initialize();
 await index.upsert([{id:'ordinary',values:vector,namespace:'ownerA',metadata:{owner:'ownerA',level:1,collection:'chats'}},{id:'private',values:vector,namespace:'ownerA',metadata:{owner:'ownerA',level:3,collection:'chats'}},{id:'other_owner',values:vector,namespace:'ownerB',metadata:{owner:'ownerB',level:0,collection:'chats'}}]);
 const search=(level,collections)=>index.query(vector,{topK:10,namespace:'ownerA',filter:{owner:'ownerA',level:{$lte:level},collection:{$in:collections}}});
 assert.deepEqual((await search(1,['chats'])).matches.map(m=>m.id),['ordinary']);
 assert.deepEqual(new Set((await search(3,['chats'])).matches.map(m=>m.id)),new Set(['ordinary','private']));
 assert.equal((await search(3,['projects'])).matches.length,0);
 await index.deleteByIds(['ordinary']);assert.equal((await search(1,['chats'])).matches.length,0);
 console.log(JSON.stringify({real_vector_tests:'passed',checks:['upsert','semantic_query','sensitivity_filter','owner_isolation','collection_filter','deletion']}));
}finally{await index.call(index.path,'DELETE');}
