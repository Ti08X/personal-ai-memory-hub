import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {writeFile} from 'node:fs/promises';
import {loadCredentials,options} from './lib.mjs';
const args=options(),c=await loadCredentials(args['credential-file'],args.client??'codex');
const client=new Client({name:'schema-export',version:'1'});
await client.connect(new StreamableHTTPClientTransport(new URL(c.endpoint+'/mcp'),{authProvider:{token:async()=>c.token}}));
try {
 const {tools}=await client.listTools();
 await writeFile('docs/tool-schemas.json',JSON.stringify({tools},null,2)+'\n');
 const byName=Object.fromEntries(tools.map(t=>[t.name,t.inputSchema]));
 const response={description:'JSON result; see docs/api.md',content:{'application/json':{schema:{type:'object',additionalProperties:true}}}};
 const operation=(name,method)=>({operationId:name,security:[{bearerAuth:[]}],responses:{'200':response,...(method==='post'?{'201':response}:{}),'400':{description:'Validation error'},'401':{description:'Missing/expired/revoked token'},'403':{description:'Insufficient scope'},'409':{description:'Version conflict retained for review'},'413':{description:'Request too large'},'422':{description:'Credential-like content rejected'},'429':{description:'Rate limit'}},...(method==='post'?{requestBody:{required:true,content:{'application/json':{schema:{$ref:'#/components/schemas/'+name}}}}}:{parameters:Object.entries(byName[name]?.properties??{}).map(([key,schema])=>({in:'query',name:key,required:byName[name].required?.includes(key)??false,schema}))})});
 const paths={'/v1/profile':{get:operation('get_profile','get')},'/v1/context':{get:operation('get_context','get')},'/v1/search':{get:operation('search_memory','get')},'/v1/memories':{post:operation('save_memory','post')},'/v1/conversations/import':{post:operation('import_conversation','post')}};
 await writeFile('docs/openapi.json',JSON.stringify({openapi:'3.1.0',info:{title:'Personal AI Memory Hub REST (five core operations)',version:'0.3.0'},servers:[{url:c.endpoint}],paths,components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer'}},schemas:byName}},null,2)+'\n');
 console.log('Saved public tool schemas and OpenAPI core-operation descriptions. No credentials exported.');
} finally {await client.close();}
