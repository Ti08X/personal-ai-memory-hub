const timestamp=(v,fallback=0)=>new Date((typeof v==='number'?v:typeof fallback==='number'?fallback:0)*1000).toISOString();
const normalizedRole=v=>['user','assistant','system','tool'].includes(v)?v:'system';
export function normalizeChatGPT(data) {
 const conversations=Array.isArray(data)?data:data.conversations;
 if(!Array.isArray(conversations))throw new Error('Expected official conversations.json array');
 return conversations.map(conv=>{
  const {mapping,...metadata}=conv, messages=[];
  if(!mapping||!conv.id)throw new Error('Conversation must have an id and mapping');
  const roots=[];
  for(const [nodeId,node] of Object.entries(mapping)) {
   if(!node.message){roots.push({nodeId,node});continue;}
   const message=node.message,parts=message.content?.parts??[];
   const content=parts.map(p=>typeof p==='string'?p:JSON.stringify(p)).join('\n');
   messages.push({id:message.id??nodeId,role:normalizedRole(message.author?.role),timestamp:timestamp(message.create_time,conv.create_time),content,raw:{node_id:nodeId,export_node:node}});
  }
  return {authorized:true,source_platform:'chatgpt',session_id:conv.id,title:conv.title??'',completeness:'full',messages,raw_metadata:{format:'chatgpt-official-export',conversation:metadata,non_message_nodes:roots,all_branches:true,scope:'Full supplied export, not a claim of access to the entire platform account.'}};
 });
}
