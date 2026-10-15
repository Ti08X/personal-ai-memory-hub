import {createHash,randomUUID} from 'node:crypto';
// Vectorize IDs are arbitrary strings; Qdrant accepts UUIDs. Store the original
// ID in payload and map deterministically so retry/deletion remains idempotent.
export function pointId(id){const h=createHash('sha256').update(id).digest('hex').slice(0,32);return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export class Vectors {
 constructor(url,collection='personal_memory_bge_m3_v1',key){
  this.url=new URL(url);if(!['http:','https:'].includes(this.url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(this.url.hostname))throw new Error('Vector endpoint must be local');
  if(!/^[a-zA-Z0-9_-]+$/.test(collection))throw new Error('Invalid vector collection');
  this.path='/collections/'+collection;this.key=key;
 }
 async call(path,method='GET',body){
  const r=await fetch(new URL(path,this.url),{method,headers:{...(this.key?{'api-key':this.key}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  if(!r.ok){await r.body?.cancel();throw new Error('Vector service unavailable ('+r.status+')');}
  const data=await r.json();if(data.status!=='ok')throw new Error('Vector operation failed');return data.result;
 }
 async initialize(){
  let details;try{details=await this.call(this.path);}catch{await this.call(this.path,'PUT',{vectors:{size:1024,distance:'Cosine',on_disk:true},on_disk_payload:true,hnsw_config:{on_disk:true},optimizers_config:{default_segment_number:1}});details=await this.call(this.path);}
  const cfg=details.config.params.vectors;if(cfg.size!==1024||cfg.distance!=='Cosine')throw new Error('Incompatible embedding index');
  for(const [field_name,field_schema] of [['namespace','keyword'],['owner','keyword'],['collection','keyword'],['level','integer']])await this.call(this.path+'/index?wait=true','PUT',{field_name,field_schema});
 }
 async upsert(items){
  const result=await this.call(this.path+'/points?wait=true','PUT',{points:items.map(v=>({id:pointId(v.id),vector:v.values,payload:{...v.metadata,namespace:v.namespace,original_id:v.id}}))});
  if(result.status!=='completed')throw new Error('Vector write not confirmed');return {mutationId:randomUUID()};
 }
 async deleteByIds(ids){const result=await this.call(this.path+'/points/delete?wait=true','POST',{points:ids.map(pointId)});if(result.status!=='completed')throw new Error('Vector delete not confirmed');return {mutationId:randomUUID()};}
 async describe(){await this.call(this.path);return {processedUpToMutation:'synchronous',processedUpToDatetime:Date.now()};}
 async query(vector,options){
  // Both database-side payload filters and the app's fresh record/version
  // permission checks are required; never return the unfiltered vector set.
  const f=options.filter,level=f?.level?.$lte,allowed=f?.collection?.$in;
  if(!options.namespace||f?.owner!==options.namespace||!Number.isInteger(level)||!Array.isArray(allowed))throw new Error('Vector policy required');
  if(!allowed.length)return {matches:[],count:0};
  const filter={must:[{key:'namespace',match:{value:options.namespace}},{key:'owner',match:{value:f.owner}},{key:'level',range:{lte:level}},{key:'collection',match:{any:allowed}}]};
  const r=await this.call(this.path+'/points/query','POST',{query:vector,filter,limit:Math.min(options.topK,50),with_payload:['original_id'],with_vector:false});
  const matches=r.points.map(p=>({id:p.payload.original_id,score:p.score}));return {matches,count:matches.length};
 }
}
