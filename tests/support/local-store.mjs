import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';
const bundled=await build({entryPoints:['src/store.ts','src/models.ts','src/model-settings.ts','src/memory-library.ts'],bundle:true,write:false,outdir:'/unused',format:'esm',platform:'node',target:'node22',absWorkingDir:new URL('../..',import.meta.url).pathname});
const modules={};for(const f of bundled.outputFiles)modules[f.path.split('/').pop()]=await import('data:text/javascript;base64,'+Buffer.from(f.text).toString('base64'));
export const {ModelSettings,runtimeModels}=modules['model-settings.js'];
export const {MemoryLibrary,calendarKeys,libraryPrincipal}=modules['memory-library.js'];
export const Store=modules['store.js'].Store;
export const {Models,chunks}=modules['models.js'];
export function database(){
 const sqlite=new DatabaseSync(':memory:');
 for(const path of readdirSync(new URL('../../migrations',import.meta.url)).filter(p=>p.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../../migrations/'+path,import.meta.url),'utf8'));
 function prepare(sql){let values=[];return {bind(...v){values=v;return this;},async run(){const result=sqlite.prepare(sql).run(...values);return {meta:{changes:Number(result.changes)}};},async first(column){const row=sqlite.prepare(sql).get(...values);return column?row?.[column]:row??null;},async all(){return {results:sqlite.prepare(sql).all(...values)};}};}
 return {sqlite,prepare,async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const stmt of statements)out.push(await stmt.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}
export function rig(){
 const DB=database(),vectors=new Map();let mutation=0,processed='';
 const VECTOR_INDEX={async upsert(v){v.forEach(x=>vectors.set(x.id,x));processed=String(++mutation);return {mutationId:processed};},async deleteByIds(ids){ids.forEach(id=>vectors.delete(id));processed=String(++mutation);return {mutationId:processed};},async describe(){return {processedUpToMutation:processed,processedUpToDatetime:Date.now()};},async query(_vector,options){return {matches:[...vectors.values()].map(v=>({id:v.id,score:0.8})),count:vectors.size};}};
 const env={DB,VECTOR_INDEX,ENCRYPTION_KEY:Buffer.alloc(32,42).toString('base64'),RAG_ENABLED:'true',SILICONFLOW_API_KEY:'local-test-placeholder',SUMMARY_API_KEY:'local-test-placeholder',SUMMARY_BASE_URL:'https://summary.example.com/v1',SUMMARY_MODEL:'test-summary',MODEL_CALLS_PER_DAY:'200'};
 const full={id:'owner-client',owner_id:'owner-a',scopes:['memory:read','memory:write','conversation:import','sensitive:read','sensitive:write','admin'],policy:{read_level:3,write_level:3,collections:['chats','memories','projects','accounts','knowledge']}};
 const store=new Store(env,full),as=(policy,scopes=['memory:read'])=>new Store(env,{id:'limited-client',owner_id:'owner-a',scopes,policy});
 const base={authorized:true,source_platform:'test-platform',source_kind:'test',timestamp:new Date().toISOString(),session_id:'test-session',text:'合成测试记录，准备建设个人记忆系统。'};
 const calls=[];
 async function mockFetch(url,options){const body=JSON.parse(options.body);calls.push({url,body});if(String(url).endsWith('/embeddings'))return Response.json({data:body.input.map((_,index)=>({index,embedding:Array.from({length:1024},(_,i)=>i===0?1:0)})).reverse()});if(String(url).endsWith('/rerank'))return Response.json({results:body.documents.map((_,index)=>({index,relevance_score:1-index*0.1}))});const evidence=JSON.parse(body.messages[1].content).evidence;return Response.json({choices:[{message:{content:JSON.stringify({overview:[{text:'正在建设记忆中心。',evidence_ids:[evidence[0].id]}],plans:[]})}}]});}
 return {env,store,as,base,full,vectors,calls,mockFetch,close:()=>DB.sqlite.close()};
}
