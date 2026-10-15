import {z} from 'zod';
import {ApiError,need,rejectCredentials} from './core';
import {canRead,canWrite,collections,level,policy,sensitivity} from './policy';
import {runtimeModels} from './model-settings';
import {categoriesSchema,OverviewModels,emptyOverview,type Digest,type OverviewContent} from './overview-models';
import type {Store} from './store';

export const overviewReadSchema=z.object({detail:z.enum(['brief','full']).default('brief'),section:z.enum(['all','personal','projects','mainline','next_actions']).default('all')}).strict();
export const classificationSchema=z.object({authorized:z.literal(true),id:z.string(),version:z.number().int().positive(),expected_revision:z.number().int().nonnegative(),categories:categoriesSchema}).strict();
type Ref={id:string;version:number;revision:number};
type Snapshot={content:OverviewContent;sources:Ref[];sensitivity:string;model:string};
type State={owner_id:string;client_id:string;enabled:number;control_version:number;revision:number;payload_cipher:string|null;error_code:string|null;updated_at:string;lease_until:string|null};
type Entry={owner_id:string;record_id:string;source_version:number;revision:number;categories_json:string;payload_cipher:string|null;method:string;updated_at:string};
const noDerived="(r.record_type!='summary' OR NOT EXISTS(SELECT 1 FROM record_evidence oe WHERE oe.record_id=r.id AND oe.version=r.version))";
function evidenceOf(r:any){const data=r.record_type==='message'?null:r.payload.data;const metadata=data?JSON.stringify(Object.fromEntries(Object.entries(data).filter(([key])=>!['raw','evidence'].includes(key)))):'';return {id:r.id,version:r.version,timestamp:r.source_timestamp,text:[r.payload.title,r.payload.text,metadata&&metadata.length<=12000?'结构化资料：'+metadata:metadata?'较大结构化资料另见原记录；本次仅根据正文提取。':''].filter(Boolean).join('\n'),source_platform:r.source_platform,source_kind:r.source_kind,record_type:r.record_type,role:r.payload.data?.role};}
export class MemoryOverview {
 constructor(private store:Store){}
 private get db(){return this.store.env.DB;}private get owner(){return this.store.principal.owner_id;}
 private async state(){return this.db.prepare('SELECT * FROM memory_overview_state WHERE owner_id=?').bind(this.owner).first<State>();}
 private async open(state:State){return this.store.vault.open(state.payload_cipher!,this.owner+':overview:'+state.revision) as Promise<Snapshot>;}
 private requireOrganizer(){
  const p=this.store.principal;need(p,'admin');need(p,'memory:read');need(p,'memory:write');need(p,'sensitive:read');need(p,'sensitive:write');
  if(policy(p).read_level!==3||policy(p).write_level!==3||collections.some(c=>!policy(p).collections.includes(c)))throw new ApiError(403,'overview_full_policy_required');
 }
 async stats(){
  need(this.store.principal,'memory:read');
  const counts=await this.db.prepare(`SELECT COUNT(*) total_sources,COALESCE(SUM(c.source_version=r.version AND c.payload_cipher IS NOT NULL),0) digested,COALESCE(SUM(c.source_version=r.version),0) classified,COALESCE(SUM(c.source_version=r.version AND EXISTS(SELECT 1 FROM json_each(c.categories_json) WHERE value='personal')),0) personal,COALESCE(SUM(c.source_version=r.version AND EXISTS(SELECT 1 FROM json_each(c.categories_json) WHERE value='development')),0) development,COALESCE(SUM(c.source_version=r.version AND EXISTS(SELECT 1 FROM json_each(c.categories_json) WHERE value='work')),0) work,COALESCE(SUM(c.source_version=r.version AND EXISTS(SELECT 1 FROM json_each(c.categories_json) WHERE value='health')),0) health,COALESCE(SUM(c.source_version=r.version AND EXISTS(SELECT 1 FROM json_each(c.categories_json) WHERE value='learning')),0) learning,COALESCE(SUM(c.source_version=r.version AND EXISTS(SELECT 1 FROM json_each(c.categories_json) WHERE value='other')),0) other FROM records r LEFT JOIN memory_classifications c ON c.record_id=r.id AND c.owner_id=r.owner_id WHERE r.owner_id=? AND ${this.store.authorizedFilter('r.')} AND ${noDerived}`).bind(this.owner).first<any>();
  return {...counts,unclassified:counts.total_sources-counts.classified,overlap:'Personal and development can overlap; classification describes topic, not verified personal facts.'};
 }
 private async valid(snapshot:Snapshot){
  if(!canRead(this.store.principal,{record_type:'summary',sensitivity:snapshot.sensitivity,logical_key:'overview.current'}))return false;
  for(let start=0;start<snapshot.sources.length;start+=60){
   const refs=snapshot.sources.slice(start,start+60);if(!refs.length)continue;
   const rows=(await this.db.prepare(`SELECT r.id,r.version,c.revision FROM records r JOIN memory_classifications c ON c.record_id=r.id AND c.owner_id=r.owner_id AND c.source_version=r.version WHERE r.owner_id=? AND r.id IN (${refs.map(()=>'?').join(',')}) AND ${this.store.authorizedFilter('r.')}`).bind(this.owner,...refs.map(r=>r.id)).all<{id:string;version:number;revision:number}>()).results;
   if(refs.some(ref=>!rows.some(row=>row.id===ref.id&&row.version===ref.version&&row.revision===ref.revision)))return false;
  }
  return true;
 }
 async read(input:unknown={}){
  need(this.store.principal,'memory:read');const v=overviewReadSchema.parse(input),state=await this.state(),counts=await this.stats(),config=await runtimeModels(this.store.env,this.owner);
  const result:any={strategy:await this.store.strategy(),version:state?.revision??0,control_version:state?.control_version??0,enabled:!!state?.enabled,updated_at:state?.revision?state.updated_at:null,configured:new OverviewModels(config).ready,counts,status:'not_generated',overview:null,index:{full:'/v1/overview?detail=full',sections:['personal','projects','mainline','next_actions'].map(section=>({section,url:'/v1/overview?detail=full&section='+section})),original_records:'/v1/records',search:'/v1/search'},organization_error:this.store.principal.scopes.includes('admin')?state?.error_code??null:null,processing:!!state?.lease_until&&Date.parse(state.lease_until)>Date.now()};
  if(!state?.payload_cipher)return result;
  result.updated_at=(await this.db.prepare('SELECT saved_at FROM memory_overview_versions WHERE owner_id=? AND revision=?').bind(this.owner,state.revision).first<{saved_at:string}>())?.saved_at??state.updated_at;
  const snapshot=await this.open(state);
  if(!await this.valid(snapshot)){result.status='stale_or_scope_restricted';return result;}
  result.status=snapshot.sources.length<counts.total_sources?'updating':'ready';
  result.coverage={included_sources:snapshot.sources.length,available_sources:counts.total_sources,scope:'Submitted, authorized sources only; not complete private platform account history.'};
  result.index.section_counts=Object.fromEntries(['personal','projects','mainline','next_actions'].map(key=>[key,snapshot.content[key as keyof Omit<OverviewContent,'brief'>].length]));
  const evidenceIndex=(items:{evidence_ids:string[]}[])=>{const used=new Set(items.flatMap(item=>item.evidence_ids));return Object.fromEntries(snapshot.sources.filter(source=>used.has(source.id)).map(source=>[source.id,{id:source.id,version:source.version}]));};
  if(v.section!=='all'){const items=snapshot.content[v.section];result.overview={section:v.section,items};result.evidence_index=evidenceIndex(items);return result;}
  const compact=(items:any[])=>items.slice(0,3).map(item=>({...item,text:item.text.slice(0,180),evidence_ids:item.evidence_ids.slice(0,2),truncated:item.text.length>180||item.evidence_ids.length>2}));
  result.overview=v.detail==='full'?snapshot.content:{brief:snapshot.content.brief,personal:compact(snapshot.content.personal),projects:snapshot.content.projects.slice(0,3).map(p=>({...p,goal:p.goal.slice(0,120),current_step:p.current_step.slice(0,120),next_step:p.next_step.slice(0,120),blockers:p.blockers.slice(0,80),evidence_ids:p.evidence_ids.slice(0,2),truncated:true})),mainline:compact(snapshot.content.mainline),next_actions:compact(snapshot.content.next_actions),detail_available:true};
  result.evidence_index=evidenceIndex([...result.overview.personal,...result.overview.projects,...result.overview.mainline,...result.overview.next_actions]);
  return result;
 }
 async configure(input:unknown){
  this.requireOrganizer();const v=z.object({authorized:z.literal(true),enabled:z.boolean(),expected_version:z.number().int().nonnegative()}).strict().parse(input),old=await this.state(),now=new Date().toISOString();
  if((old?.control_version??0)!==v.expected_version)throw new ApiError(409,'overview_settings_conflict');
  if(v.enabled&&!new OverviewModels(await runtimeModels(this.store.env,this.owner)).ready)throw new ApiError(503,'summary_not_configured');
  const changed=old?await this.db.prepare('UPDATE memory_overview_state SET enabled=?,client_id=?,control_version=control_version+1,error_code=NULL,updated_at=? WHERE owner_id=? AND control_version=?').bind(Number(v.enabled),this.store.principal.id,now,this.owner,v.expected_version).run():await this.db.prepare('INSERT OR IGNORE INTO memory_overview_state(owner_id,client_id,enabled,updated_at) VALUES(?,?,?,?)').bind(this.owner,this.store.principal.id,Number(v.enabled),now).run();
  if(!changed.meta.changes)throw new ApiError(409,'overview_settings_conflict');
  await this.store.audit('overview_organization_configured',String(v.enabled));return this.read();
 }
 async classify(input:unknown){
  need(this.store.principal,'memory:write');const v=classificationSchema.parse(input),record=await this.store.get(v.id);
  if(record.version!==v.version)throw new ApiError(409,'evidence_version_changed');if(!canWrite(this.store.principal,record))throw new ApiError(403,'record_policy_denied');
  if(record.record_type==='summary'&&record.payload.data?.evidence?.length)throw new ApiError(422,'classification_derived_record');
  const old=await this.db.prepare('SELECT * FROM memory_classifications WHERE owner_id=? AND record_id=?').bind(this.owner,v.id).first<Entry>();
  if((old?.revision??0)!==v.expected_revision)throw new ApiError(409,'classification_conflict');
  const now=new Date().toISOString();
  const result=old?await this.db.prepare('UPDATE memory_classifications SET categories_json=?,source_version=?,revision=revision+1,method=?,payload_cipher=CASE WHEN source_version=? THEN payload_cipher ELSE NULL END,updated_at=? WHERE owner_id=? AND record_id=? AND revision=? AND EXISTS(SELECT 1 FROM records WHERE id=? AND owner_id=? AND version=?)').bind(JSON.stringify(v.categories),v.version,'manual',v.version,now,this.owner,v.id,v.expected_revision,v.id,this.owner,v.version).run():await this.db.prepare('INSERT OR IGNORE INTO memory_classifications SELECT ?,?,?,1,?,NULL,?,? WHERE EXISTS(SELECT 1 FROM records WHERE id=? AND owner_id=? AND version=?)').bind(this.owner,v.id,v.version,JSON.stringify(v.categories),'manual',now,v.id,this.owner,v.version).run();
  if(!result.meta.changes)throw new ApiError(409,'classification_conflict');await this.store.audit('record_classified',v.id);return {id:v.id,revision:v.expected_revision+1,categories:v.categories};
 }
 async process(){
  this.requireOrganizer();const initial=await this.state();if(!initial?.enabled)throw new ApiError(409,'overview_organization_disabled');
  const lease=new Date(Date.now()+180000).toISOString(),claimed=await this.db.prepare('UPDATE memory_overview_state SET lease_until=? WHERE owner_id=? AND enabled=1 AND (lease_until IS NULL OR lease_until<?)').bind(lease,this.owner,new Date().toISOString()).run();
  if(!claimed.meta.changes)return {status:'busy'};
  try{
   const models=new OverviewModels(await runtimeModels(this.store.env,this.owner));if(!models.ready)throw new ApiError(503,'summary_not_configured');
   const candidates=(await this.db.prepare(`SELECT r.id,r.version FROM records r LEFT JOIN memory_classifications c ON c.record_id=r.id AND c.owner_id=r.owner_id WHERE r.owner_id=? AND ${this.store.authorizedFilter('r.')} AND ${noDerived} AND (c.record_id IS NULL OR c.source_version!=r.version OR c.payload_cipher IS NULL) ORDER BY r.source_timestamp,r.id LIMIT 12`).bind(this.owner).all<{id:string;version:number}>()).results;
   const records=[],evidence=[];let chars=0;
   for(const c of candidates){const record=await this.store.get(c.id),input=evidenceOf(record);if(chars+input.text.length>32000&&records.length)break;records.push(record);evidence.push(input);chars+=input.text.length;}
   if(records.length){
    await this.store.recordModelAttempt('classification',chars);
    const expected=await Promise.all(records.map(r=>this.db.prepare('SELECT * FROM memory_classifications WHERE owner_id=? AND record_id=?').bind(this.owner,r.id).first<Entry>()));
    const extracted=await models.extract(evidence);
    for(let i=0;i<records.length;i++){
     const r=records[i],old=expected[i],digest=extracted.find(d=>d.id===r.id)!;if(old?.method==='manual')digest.categories=JSON.parse(old.categories_json);
     const fresh=await this.store.get(r.id);if(fresh.version!==r.version)throw new ApiError(409,'evidence_version_changed');
     const cipher=await this.store.vault.seal({...digest,timestamp:r.source_timestamp,source_platform:r.source_platform,source_kind:r.source_kind,role:r.payload.data?.role},this.owner+':digest:'+r.id+':'+r.version),now=new Date().toISOString();
     if(old)await this.db.prepare('UPDATE memory_classifications SET source_version=?,revision=revision+1,categories_json=?,payload_cipher=?,updated_at=? WHERE owner_id=? AND record_id=? AND revision=? AND EXISTS(SELECT 1 FROM records WHERE id=? AND owner_id=? AND version=?)').bind(r.version,JSON.stringify(digest.categories),cipher,now,this.owner,r.id,old.revision,r.id,this.owner,r.version).run();
     else await this.db.prepare('INSERT OR IGNORE INTO memory_classifications SELECT ?,?,?,1,?,?,?,? WHERE EXISTS(SELECT 1 FROM records WHERE id=? AND owner_id=? AND version=?)').bind(this.owner,r.id,r.version,JSON.stringify(digest.categories),cipher,'model',now,r.id,this.owner,r.version).run();
    }
   }
   const state=(await this.state())!,snapshot=state.payload_cipher?await this.open(state):null;
   const valid=!!snapshot&&await this.valid(snapshot),previous=valid?snapshot!:({content:emptyOverview(),sources:[],sensitivity:'public',model:''} as Snapshot);
   const seen=new Set(previous.sources.map(r=>r.id));
   const available=(await this.db.prepare(`SELECT c.* FROM memory_classifications c JOIN records r ON r.id=c.record_id AND r.owner_id=c.owner_id AND r.version=c.source_version WHERE c.owner_id=? AND c.payload_cipher IS NOT NULL AND ${this.store.authorizedFilter('r.')} AND ${noDerived} ORDER BY r.source_timestamp,r.id`).bind(this.owner).all<Entry>()).results.filter(e=>!seen.has(e.record_id)).slice(0,12);
   if(!available.length){await this.db.prepare('UPDATE memory_overview_state SET error_code=NULL WHERE owner_id=? AND lease_until=?').bind(this.owner,lease).run();return {status:'idle',classified:records.length,merged:0};}
   const entries=await Promise.all(available.map(async e=>({...await this.store.vault.open(e.payload_cipher!,this.owner+':digest:'+e.record_id+':'+e.source_version) as Digest&{timestamp:string;source_platform:string;source_kind:string;role?:string},categories:JSON.parse(e.categories_json)})));
   const sources=[...previous.sources,...available.map(e=>({id:e.record_id,version:e.source_version,revision:e.revision}))],maxLevel=Math.max(level(previous.sensitivity),...(await Promise.all(available.map(e=>this.store.get(e.record_id)))).map(r=>level(r.sensitivity)));
   await this.store.recordModelAttempt('overview',JSON.stringify({previous:previous.content,entries}).length);
   const content=await models.merge(previous.content,entries,new Set(sources.map(r=>r.id))),next:Snapshot={content,sources,sensitivity:sensitivity(maxLevel),model:(await runtimeModels(this.store.env,this.owner)).SUMMARY_MODEL!};
   if(!await this.valid(next))throw new ApiError(409,'evidence_version_changed');rejectCredentials(content);
   const revision=state.revision+1,cipher=await this.store.vault.seal(next,this.owner+':overview:'+revision),now=new Date().toISOString();
   const changed=await this.db.batch([
    this.db.prepare('UPDATE memory_overview_state SET revision=?,payload_cipher=?,error_code=NULL,updated_at=? WHERE owner_id=? AND revision=? AND lease_until=? AND enabled=1').bind(revision,cipher,now,this.owner,state.revision,lease),
    this.db.prepare('INSERT OR IGNORE INTO memory_overview_versions SELECT owner_id,revision,payload_cipher,updated_at FROM memory_overview_state WHERE owner_id=? AND revision=? AND payload_cipher=?').bind(this.owner,revision,cipher)
   ]);
   if(!changed[0].meta.changes)throw new ApiError(409,'overview_settings_conflict');
   await this.store.audit('overview_batch_generated',String(available.length));return {status:'processed',classified:records.length,merged:available.length,version:revision};
  }catch(e){const code=e instanceof ApiError?e.code:'overview_service_unavailable';if(e instanceof ApiError){const status=(e.details as {upstream_status?:number})?.upstream_status;await this.store.audit('overview_model_failure',code+(Number.isInteger(status)?':http_'+status:''));}await this.db.prepare('UPDATE memory_overview_state SET error_code=? WHERE owner_id=? AND lease_until=?').bind(code,this.owner,lease).run();throw e;}
  finally{await this.db.prepare('UPDATE memory_overview_state SET lease_until=NULL WHERE owner_id=? AND lease_until=?').bind(this.owner,lease).run();}
 }
 async history(input:unknown={}){
  this.requireOrganizer();const v=z.object({version:z.coerce.number().int().positive().optional(),cursor:z.coerce.number().int().nonnegative().default(0)}).strict().parse(input);
  if(v.version){const row=await this.db.prepare('SELECT payload_cipher,saved_at FROM memory_overview_versions WHERE owner_id=? AND revision=?').bind(this.owner,v.version).first<{payload_cipher:string;saved_at:string}>();if(!row)throw new ApiError(404,'overview_version_not_found');const snapshot=await this.store.vault.open(row.payload_cipher,this.owner+':overview:'+v.version) as Snapshot;for(let start=0;start<snapshot.sources.length;start+=60){const ids=snapshot.sources.slice(start,start+60).map(source=>source.id);const count=await this.db.prepare(`SELECT COUNT(*) count FROM records r WHERE r.owner_id=? AND r.id IN (${ids.map(()=>'?').join(',')}) AND ${this.store.authorizedFilter('r.')}`).bind(this.owner,...ids).first<{count:number}>();if(count?.count!==ids.length)throw new ApiError(404,'overview_history_source_unavailable');}return {version:v.version,updated_at:row.saved_at,historical:true,overview:snapshot.content,evidence_index:Object.fromEntries(snapshot.sources.map(source=>[source.id,{id:source.id,version:source.version}])),coverage:{included_sources:snapshot.sources.length,available_sources:snapshot.sources.length},counts:{classified:snapshot.sources.length,total_sources:snapshot.sources.length},note:'Historical snapshot, not current facts. References bind to the original versions; use record history when a source has changed.'};}
  const rows=(await this.db.prepare('SELECT revision,saved_at FROM memory_overview_versions WHERE owner_id=? ORDER BY revision DESC LIMIT 51 OFFSET ?').bind(this.owner,v.cursor).all()).results;return {versions:rows.slice(0,50),next_cursor:rows.length>50?v.cursor+50:null,note:'Encrypted snapshots retained; current overview suppresses stale or inaccessible source evidence.'};
 }
}
