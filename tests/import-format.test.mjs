import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeChatGPT} from '../scripts/import-format.mjs';
test('official export keeps both conversation branches and original node metadata',()=>{
 const mapping={root:{id:'root',parent:null,children:['user'],message:null},user:{parent:'root',children:['a','b'],message:{id:'u',author:{role:'user'},create_time:100,content:{parts:['你好']}}},a:{parent:'user',children:[],message:{id:'a',author:{role:'assistant'},create_time:101,content:{parts:['第一版']}}},b:{parent:'user',children:[],message:{id:'b',author:{role:'assistant'},create_time:102,content:{parts:['第二版']},metadata:{revision:true}}}};
 const [result]=normalizeChatGPT([{id:'session',title:'枝杈',create_time:99,current_node:'b',mapping}]);
 assert.deepEqual(result.messages.map(m=>m.id),['u','a','b']);
 assert.deepEqual(result.messages.find(m=>m.id==='b').raw.export_node,mapping.b);
 assert.equal(result.raw_metadata.non_message_nodes[0].node.children[0],'user');
 assert.equal(result.raw_metadata.conversation.current_node,'b');
 assert.equal(result.messages[0].timestamp,'1970-01-01T00:01:40.000Z');
});
test('unsupported export fails explicitly instead of fabricating conversation history',()=>{
 assert.throws(()=>normalizeChatGPT({unexpected:'format'}));
 assert.throws(()=>normalizeChatGPT([{title:'missing stable id'}]));
});
