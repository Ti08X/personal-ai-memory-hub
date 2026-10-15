import {z} from 'zod';
import {ApiError,need,rejectCredentials,canonical,type Env,type Principal} from './core';
import {collections,policy,canWrite} from './policy';
import {runtimeModels} from './model-settings';
import {OverviewModels,emptyOverview,categoriesSchema,type Digest,type OverviewContent} from './overview-models';
import type {Store} from './store';
import {MemoryOverview,overviewReadSchema} from './memory-overview';

export const scopeKinds=['conversation','category','project','day','week','month'] as const;
export const libraryReadSchema=z.object({kind:z.enum(scopeKinds).optional(),cursor:z.coerce.number().int().nonnegative().default(0),limit:z.coerce.number().int().min(1).max(30).default(20)}).strict();
export const labelFindSchema=z.object({kind:z.enum(['tag','project']),name:z.string().trim().min(1).max(120),cursor:z.coerce.number().int().nonnegative().default(0),limit:z.coerce.number().int().min(1).max(50).default(20)}).strict();
export const taxonomySchema=z.object({authorized:z.literal(true),id:z.string(),version:z.number().int().positive(),expected_revision:z.number().int().nonnegative(),expected_classification_revision:z.number().int().nonnegative(),categories:categoriesSchema,tags:z.array(z.string().trim().min(1).max(64)).max(24),projects:z.array(z.string().trim().min(1).max(120)).max(12)}).strict();
type Labels={tags:string[];projects:string[]};
type LabelRow={source_version:number;classification_revision:number;revision:number;payload_cipher:string;method:string;extracted:number};
type SourceRow={id:string;version:number;source_timestamp:string;source_platform:string;session_id:string;record_type:string;logical_key:string|null;sensitivity:string};
type Classification={source_version:number;revision:number;categories_json:string;payload_cipher:string|null;method:string};
type Scope={id:string;owner_id:string;kind:typeof scopeKinds[number];scope_key:string;title_cipher:string;status:string;generation:number;revision:number;cursor:number;covered:number;payload_cipher:string|null;work_cipher:string|null;invalid_before:number;error_code:string|null;attempts:number;retry_at:string|null;updated_at:string};
const originals="(r.record_type!='summary' OR NOT EXISTS(SELECT 1 FROM record_evidence e WHERE e.record_id=r.id AND e.version=r.version))";
const categoryNames:Record<string,string>={personal:'个人信息',development:'项目开发',work:'工作事业',health:'生活健康',learning:'学习研究',other:'其他讨论'};
const clean=(values:string[])=>[...new Set(values.map(v=>v.normalize('NFKC').trim()).filter(Boolean))];
const refs=(v:OverviewContent)=>[...new Set([...v.personal,...v.projects,...v.mainline,...v.next_actions].flatMap(x=>x.evidence_ids))];
const blank=()=>emptyOverview();
export function calendarKeys(timestamp:string){
 const day=new Date(Date.parse(timestamp)+8*3600000).toISOString().slice(0,10),date=new Date(day+'T00:00:00Z');
 date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));
 return {day,week:date.toISOString().slice(0,10),month:day.slice(0,7)};
}
export async function libraryPrincipal(env:Env,owner:string,client:string):Promise<Principal>{
 const row=await env.DB.prepare('SELECT id,owner_id,scopes,policy_json,name FROM clients WHERE id=? AND owner_id=? AND revoked_at IS NULL AND expires_at>?').bind(client,owner,new Date().toISOString()).first<{id:string;owner_id:string;scopes:string;policy_json:string|null;name:string}>();
 if(!row)throw new ApiError(403,'library_authorization_expired');
 const p:Principal={id:row.id,owner_id:row.owner_id,scopes:JSON.parse(row.scopes),...(row.policy_json?{policy:JSON.parse(row.policy_json)}:{})};
 if(row.name==='dashboard-login-service')p.policy={read_level:3,write_level:3,collections:[...collections]};
 return p;
}
export class MemoryLibrary {
 constructor(private store:Store){}
 private get db(){return this.store.env.DB;}private get owner(){return this.store.principal.owner_id;}
 private filter(alias='r.'){return this.store.authorizedFilter(alias);}
 private async settings(){return this.db.prepare('SELECT * FROM library_settings WHERE owner_id=?').bind(this.owner).first<{client_id:string;enabled:number;revision:number;lease_until:string|null}>();}
 private organizer(p:Principal=this.store.principal){for(const s of ['admin','memory:read','memory:write','sensitive:read','sensitive:write'])need(p,s);const v=policy(p);if(v.read_level!==3||v.write_level!==3||collections.some(c=>!v.collections.includes(c)))throw new ApiError(403,'library_full_policy_required');}
 async installed(){return !!await this.settings();}
 async enabled(){return !!(await this.settings())?.enabled;}
 async configure(input:unknown){
  this.organizer();const v=z.object({authorized:z.literal(true),enabled:z.boolean(),expected_revision:z.number().int().nonnegative()}).strict().parse(input),old=await this.settings();
  if((old?.revision??0)!==v.expected_revision)throw new ApiError(409,'library_control_conflict');
  if(v.enabled&&!new OverviewModels(await runtimeModels(this.store.env,this.owner)).ready)throw new ApiError(503,'summary_not_configured');
  const now=new Date().toISOString(),result=old?await this.db.prepare('UPDATE library_settings SET enabled=?,client_id=?,revision=revision+1,updated_at=? WHERE owner_id=? AND revision=?').bind(Number(v.enabled),this.store.principal.id,now,this.owner,v.expected_revision).run():await this.db.prepare('INSERT OR IGNORE INTO library_settings(owner_id,client_id,enabled,updated_at) VALUES(?,?,?,?)').bind(this.owner,this.store.principal.id,Number(v.enabled),now).run();
  if(!result.meta.changes)throw new ApiError(409,'library_control_conflict');
  if(v.enabled)await this.db.prepare('UPDATE memory_overview_state SET enabled=0 WHERE owner_id=?').bind(this.owner).run();
  await this.store.audit('library_configured',String(v.enabled));return this.status();
 }
 async labels(id:string){
  const record=await this.store.get(id),row=await this.db.prepare('SELECT * FROM library_labels WHERE owner_id=? AND record_id=?').bind(this.owner,id).first<LabelRow>();
  const current=!!row&&row.source_version===record.version&&row.classification_revision===record.classification?.revision;
  return {id,version:record.version,classification_revision:record.classification?.revision??0,categories:record.classification?.categories??[],revision:row?.revision??0,status:current?'ready':'pending',labels:current?await this.store.vault.open(row!.payload_cipher,this.owner+':labels:'+id) as Labels:{tags:[],projects:[]},method:row?.method??null};
 }
 async taxonomy(input:unknown){
  need(this.store.principal,'memory:write');const v=taxonomySchema.parse(input),record=await this.store.get(v.id);rejectCredentials(v);
  if(record.version!==v.version)throw new ApiError(409,'evidence_version_changed');
  if(!canWrite(this.store.principal,record))throw new ApiError(403,'record_policy_denied');
  if(record.record_type==='summary'&&record.payload.data?.evidence?.length)throw new ApiError(422,'classification_derived_record');
  const old=await this.db.prepare('SELECT * FROM memory_classifications WHERE owner_id=? AND record_id=?').bind(this.owner,v.id).first<Classification>(),label=await this.db.prepare('SELECT * FROM library_labels WHERE owner_id=? AND record_id=?').bind(this.owner,v.id).first<LabelRow>();
  if((old?.revision??0)!==v.expected_classification_revision||(label?.revision??0)!==v.expected_revision)throw new ApiError(409,'classification_conflict');
  const digest:Digest=old?.payload_cipher&&old.source_version===v.version?await this.store.vault.open(old.payload_cipher,this.owner+':digest:'+v.id+':'+v.version) as Digest:{id:v.id,categories:v.categories,facts:[],tags:[]};
  digest.categories=v.categories;digest.tags=clean(v.tags);
  const cipher=await this.store.vault.seal(digest,this.owner+':digest:'+v.id+':'+v.version),labelCipher=await this.store.vault.seal({tags:clean(v.tags),projects:clean(v.projects)},this.owner+':labels:'+v.id),now=new Date().toISOString(),revision=(old?.revision??0)+1;
  const first=old?this.db.prepare('UPDATE memory_classifications SET source_version=?,revision=revision+1,categories_json=?,payload_cipher=?,method=?,updated_at=? WHERE owner_id=? AND record_id=? AND revision=? AND EXISTS(SELECT 1 FROM records WHERE id=? AND version=?)').bind(v.version,JSON.stringify(v.categories),cipher,'manual',now,this.owner,v.id,old.revision,v.id,v.version):this.db.prepare('INSERT OR IGNORE INTO memory_classifications SELECT ?,?,?,1,?,?,?,? WHERE EXISTS(SELECT 1 FROM records WHERE id=? AND owner_id=? AND version=?)').bind(this.owner,v.id,v.version,JSON.stringify(v.categories),cipher,'manual',now,v.id,this.owner,v.version);
  const extracted=!!old?.payload_cipher&&old.source_version===v.version;
  const result=await this.db.batch([first,this.db.prepare('INSERT INTO library_labels(owner_id,record_id,source_version,classification_revision,revision,payload_cipher,method,updated_at,extracted) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM memory_classifications WHERE record_id=? AND owner_id=? AND payload_cipher=?) ON CONFLICT(owner_id,record_id) DO UPDATE SET source_version=excluded.source_version,classification_revision=excluded.classification_revision,revision=excluded.revision,payload_cipher=excluded.payload_cipher,method=excluded.method,updated_at=excluded.updated_at,extracted=excluded.extracted').bind(this.owner,v.id,v.version,revision,(label?.revision??0)+1,labelCipher,'manual',now,Number(extracted),v.id,this.owner,cipher)]);
  if(!result[0].meta.changes)throw new ApiError(409,'classification_conflict');
  await this.syncScopes(record,revision,v.categories,{tags:clean(v.tags),projects:clean(v.projects)});
  await this.writeLabelKeys(record,revision,{tags:clean(v.tags),projects:clean(v.projects)});
  await this.store.audit('library_taxonomy_changed',v.id);return this.labels(v.id);
 }
 private async scope(kind:Scope['kind'],key:string,title:string){
  const hash=await this.store.vault.hash('library-scope:'+canonical([this.owner,kind,key])),id='scope_'+hash.slice(0,40),cipher=await this.store.vault.seal({title},this.owner+':scope-title:'+id);
  await this.db.prepare('INSERT OR IGNORE INTO library_scopes(id,owner_id,kind,scope_key,title_cipher,updated_at) VALUES(?,?,?,?,?,?)').bind(id,this.owner,kind,kind==='project'||kind==='conversation'?hash:key,cipher,new Date().toISOString()).run();return id;
 }
 private async writeLabelKeys(record:SourceRow,revision:number,labels:Labels){
  const statements=[this.db.prepare('DELETE FROM library_label_keys WHERE owner_id=? AND record_id=? AND EXISTS(SELECT 1 FROM records r JOIN memory_classifications c ON c.record_id=r.id AND c.owner_id=r.owner_id WHERE r.id=? AND r.version=? AND c.revision=?)').bind(this.owner,record.id,record.id,record.version,revision)];
  for(const [kind,values] of [['tag',labels.tags],['project',labels.projects]] as const)for(const name of values){const key=await this.store.vault.hash('label:'+this.owner+':'+kind+':'+name.normalize('NFKC').toLowerCase());statements.push(this.db.prepare('INSERT OR IGNORE INTO library_label_keys SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM records r JOIN memory_classifications c ON c.record_id=r.id AND c.owner_id=r.owner_id WHERE r.id=? AND r.version=? AND c.revision=?)').bind(this.owner,record.id,record.version,revision,kind,key,record.id,record.version,revision));}
  await this.db.batch(statements);
 }
 async find(input:unknown){
  need(this.store.principal,'memory:read');const v=labelFindSchema.parse(input),key=await this.store.vault.hash('label:'+this.owner+':'+v.kind+':'+v.name.normalize('NFKC').toLowerCase());
  const rows=(await this.db.prepare(`SELECT r.id FROM library_label_keys k JOIN records r ON r.id=k.record_id JOIN memory_classifications c ON c.record_id=r.id AND c.owner_id=r.owner_id WHERE k.owner_id=? AND k.kind=? AND k.key_hash=? AND k.source_version=r.version AND k.classification_revision=c.revision AND ${this.filter()} ORDER BY r.source_timestamp DESC,r.id LIMIT ? OFFSET ?`).bind(this.owner,v.kind,key,v.limit+1,v.cursor).all<{id:string}>()).results;
  return {records:await Promise.all(rows.slice(0,v.limit).map(r=>this.store.get(r.id))),next_cursor:rows.length>v.limit?v.cursor+v.limit:null};
 }
 private async syncScopes(record:SourceRow,revision:number,categories:string[],labels:Labels){
  const descriptors:{kind:Scope['kind'];key:string;title:string}[]=categories.map(c=>({kind:'category',key:c,title:categoryNames[c]??c}));
  for(const name of labels.projects)descriptors.push({kind:'project',key:name,title:name});
  const time=calendarKeys(record.source_timestamp);for(const kind of ['day','week','month'] as const)descriptors.push({kind,key:time[kind],title:(kind==='week'?'周起始：':'')+time[kind]});
  if(record.record_type==='message')descriptors.push({kind:'conversation',key:canonical([record.source_platform,record.session_id]),title:record.source_platform+' · '+record.session_id});
  const ids=[];for(const d of descriptors)ids.push(await this.scope(d.kind,d.key,d.title));
  const old=(await this.db.prepare('SELECT scope_id,source_version,classification_revision FROM library_members WHERE record_id=?').bind(record.id).all<{scope_id:string;source_version:number;classification_revision:number}>()).results;
  for(const m of old)if(!ids.includes(m.scope_id))await this.db.batch([this.db.prepare("UPDATE library_scopes SET status='pending',generation=generation+1,cursor=0,covered=0,work_cipher=NULL,invalid_before=revision+1,retry_at=NULL WHERE id=?").bind(m.scope_id),this.db.prepare('DELETE FROM library_members WHERE scope_id=? AND record_id=?').bind(m.scope_id,record.id)]);
  for(const id of ids){const m=old.find(m=>m.scope_id===id);if(m?.source_version===record.version&&m.classification_revision===revision)continue;
   await this.db.batch([
    this.db.prepare('INSERT INTO library_members(scope_id,record_id,source_version,classification_revision) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM records r JOIN memory_classifications c ON c.record_id=r.id AND c.owner_id=r.owner_id WHERE r.id=? AND r.version=? AND c.revision=?) ON CONFLICT(scope_id,record_id) DO UPDATE SET source_version=excluded.source_version,classification_revision=excluded.classification_revision').bind(id,record.id,record.version,revision,record.id,record.version,revision),
    this.db.prepare("UPDATE library_scopes SET status='pending',generation=generation+1,error_code=NULL,retry_at=NULL,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM library_members WHERE scope_id=? AND record_id=? AND source_version=? AND classification_revision=?)").bind(new Date().toISOString(),id,id,record.id,record.version,revision)
   ]);
  }
 }
 private async withLease<T>(fn:()=>Promise<T>){
  this.organizer();const now=new Date().toISOString(),lease=new Date(Date.now()+240000).toISOString();
  const changed=await this.db.prepare('UPDATE library_settings SET lease_until=? WHERE owner_id=? AND enabled=1 AND (lease_until IS NULL OR lease_until<?)').bind(lease,this.owner,now).run();
  if(!changed.meta.changes){if(!(await this.enabled()))throw new ApiError(409,'library_disabled');return {status:'busy'};}
  try{return await fn();}finally{await this.db.prepare('UPDATE library_settings SET lease_until=NULL WHERE owner_id=? AND lease_until=?').bind(this.owner,lease).run();}
 }
 private async active(){if(!await this.enabled())throw new ApiError(409,'library_disabled');const control=await this.settings();if(control?.client_id!==this.store.principal.id)throw new ApiError(409,'library_control_changed');const p=await libraryPrincipal(this.store.env,this.owner,this.store.principal.id);this.organizer(p);}
 async extract(){return this.withLease(async()=>{
  const candidates=(await this.db.prepare(`SELECT r.id FROM records r LEFT JOIN memory_classifications c ON c.owner_id=r.owner_id AND c.record_id=r.id LEFT JOIN library_labels l ON l.record_id=r.id AND l.owner_id=r.owner_id LEFT JOIN library_source_errors x ON x.record_id=r.id AND x.owner_id=r.owner_id WHERE r.owner_id=? AND ${this.filter()} AND ${originals} AND (c.record_id IS NULL OR c.source_version!=r.version OR c.payload_cipher IS NULL OR l.record_id IS NULL OR l.source_version!=r.version OR l.classification_revision!=c.revision OR l.extracted=0) AND (x.record_id IS NULL OR x.source_version!=r.version OR x.retry_at<=?) ORDER BY r.source_timestamp,r.id LIMIT 2`).bind(this.owner,new Date().toISOString()).all<{id:string}>()).results;
  let completed=0;const models=new OverviewModels(await runtimeModels(this.store.env,this.owner));
  for(const {id} of candidates){const record=await this.store.get(id),old=await this.db.prepare('SELECT * FROM memory_classifications WHERE owner_id=? AND record_id=?').bind(this.owner,id).first<Classification>();
   try{
    let digest:Digest,refreshed=false;
    const priorLabels=await this.db.prepare('SELECT * FROM library_labels WHERE owner_id=? AND record_id=?').bind(this.owner,id).first<LabelRow>();
    const cached=old?.payload_cipher&&old.source_version===record.version&&priorLabels?.extracted!==0?await this.store.vault.open(old.payload_cipher,this.owner+':digest:'+id+':'+record.version) as Digest:null;
    if(cached&&Array.isArray(cached.tags))digest=cached;
    else{refreshed=true;const input={id,version:record.version,text:[record.payload.title,record.payload.text].filter(Boolean).join('\n'),timestamp:record.source_timestamp,role:record.payload.data?.role,record_type:record.record_type,source_platform:record.source_platform,source_kind:record.source_kind};await this.store.recordModelAttempt('classification',input.text.length);[digest]=await models.extract([input]);}
    if(old?.method==='manual')digest.categories=JSON.parse(old.categories_json);
    await this.active();const fresh=await this.store.get(id);if(fresh.version!==record.version)throw new ApiError(409,'evidence_version_changed');
    const now=new Date().toISOString();let revision=old?.revision??0;
    if(refreshed||!old?.payload_cipher||old.source_version!==record.version||priorLabels?.extracted===0){
     const cipher=await this.store.vault.seal(digest,this.owner+':digest:'+id+':'+record.version);revision++;
     const result=old?await this.db.prepare('UPDATE memory_classifications SET source_version=?,revision=?,categories_json=?,payload_cipher=?,updated_at=? WHERE owner_id=? AND record_id=? AND revision=? AND EXISTS(SELECT 1 FROM records WHERE id=? AND version=?)').bind(record.version,revision,JSON.stringify(digest.categories),cipher,now,this.owner,id,old.revision,id,record.version).run():await this.db.prepare('INSERT OR IGNORE INTO memory_classifications SELECT ?,?,?,1,?,?,?,? WHERE EXISTS(SELECT 1 FROM records WHERE id=? AND owner_id=? AND version=?)').bind(this.owner,id,record.version,JSON.stringify(digest.categories),cipher,'model',now,id,this.owner,record.version).run();if(!result.meta.changes)throw new ApiError(409,'classification_conflict');
    }
    const label=await this.db.prepare('SELECT * FROM library_labels WHERE owner_id=? AND record_id=?').bind(this.owner,id).first<LabelRow>();
    const labels:Labels=label?.method==='manual'?await this.store.vault.open(label.payload_cipher,this.owner+':labels:'+id) as Labels:{tags:clean([...(record.payload.tags??[]),...(digest.tags??[])]).slice(0,24),projects:clean(digest.facts.map(f=>f.project)).slice(0,12)};
    await this.syncScopes(record,revision,digest.categories,labels);
    await this.writeLabelKeys(record,revision,labels);
    const cipher=await this.store.vault.seal(labels,this.owner+':labels:'+id);
    const result=await this.db.prepare('INSERT INTO library_labels(owner_id,record_id,source_version,classification_revision,revision,payload_cipher,method,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM records r JOIN memory_classifications c ON c.record_id=r.id AND c.owner_id=r.owner_id WHERE r.id=? AND r.version=? AND c.revision=?) ON CONFLICT(owner_id,record_id) DO UPDATE SET source_version=excluded.source_version,classification_revision=excluded.classification_revision,revision=excluded.revision,payload_cipher=excluded.payload_cipher,updated_at=excluded.updated_at,extracted=1').bind(this.owner,id,record.version,revision,(label?.revision??0)+1,cipher,label?.method??'model',now,id,record.version,revision).run();if(!result.meta.changes)throw new ApiError(409,'evidence_version_changed');
    await this.db.prepare('DELETE FROM library_source_errors WHERE owner_id=? AND record_id=?').bind(this.owner,id).run();completed++;
   }catch(e){const code=e instanceof ApiError?e.code:'library_extract_failed';await this.db.prepare('INSERT INTO library_source_errors VALUES(?,?,?,?,1,?) ON CONFLICT(owner_id,record_id) DO UPDATE SET source_version=excluded.source_version,error_code=excluded.error_code,attempts=attempts+1,retry_at=excluded.retry_at').bind(this.owner,id,record.version,code,new Date(Date.now()+300000).toISOString()).run();}
  }
  return {status:candidates.length?'processed':'idle',extracted:completed,failed:candidates.length-completed};
 });}
 private scopeFilter(){return `EXISTS(SELECT 1 FROM library_members m WHERE m.scope_id=s.id) AND NOT EXISTS(SELECT 1 FROM library_members m LEFT JOIN records r ON r.id=m.record_id LEFT JOIN memory_classifications c ON c.record_id=r.id AND c.owner_id=r.owner_id WHERE m.scope_id=s.id AND (r.id IS NULL OR r.owner_id!=s.owner_id OR r.version!=m.source_version OR c.revision IS NULL OR c.source_version!=r.version OR c.revision!=m.classification_revision OR EXISTS(SELECT 1 FROM library_labels ll WHERE ll.owner_id=r.owner_id AND ll.record_id=r.id AND ll.extracted=0) OR NOT (${this.filter()})))`;}
 async summarize(){return this.withLease(async()=>{
  const scope=await this.db.prepare(`SELECT s.* FROM library_scopes s WHERE s.owner_id=? AND s.status IN ('pending','processing','failed') AND (s.retry_at IS NULL OR s.retry_at<=?) AND ${this.scopeFilter()} ORDER BY CASE s.kind WHEN 'month' THEN 0 WHEN 'project' THEN 1 WHEN 'category' THEN 2 ELSE 3 END,s.updated_at,s.id LIMIT 1`).bind(this.owner,new Date().toISOString()).first<Scope>();
  if(!scope)return {status:'idle'};
  try{
   const members=(await this.db.prepare('SELECT m.seq,m.record_id,c.payload_cipher,c.categories_json,r.source_timestamp FROM library_members m JOIN records r ON r.id=m.record_id JOIN memory_classifications c ON c.record_id=r.id AND c.owner_id=r.owner_id AND c.source_version=r.version WHERE m.scope_id=? AND m.seq>? ORDER BY m.seq LIMIT 12').bind(scope.id,scope.cursor).all<{seq:number;record_id:string;payload_cipher:string;categories_json:string;source_timestamp:string}>()).results;
   if(!members.length){await this.db.prepare("UPDATE library_scopes SET status='ready',retry_at=NULL,error_code=NULL WHERE id=? AND generation=?").bind(scope.id,scope.generation).run();return {status:'idle',scope_id:scope.id};}
   const previous:OverviewContent=scope.work_cipher?await this.store.vault.open(scope.work_cipher,this.owner+':scope-work:'+scope.id) as OverviewContent:scope.cursor&&scope.payload_cipher?await this.store.vault.open(scope.payload_cipher,this.owner+':scope:'+scope.id+':'+scope.revision) as OverviewContent:blank();
   const entries=[];for(const m of members){const record=await this.store.get(m.record_id),digest=await this.store.vault.open(m.payload_cipher,this.owner+':digest:'+m.record_id+':'+record.version) as Digest;entries.push({...digest,categories:JSON.parse(m.categories_json),timestamp:m.source_timestamp,source_platform:record.source_platform,source_kind:record.source_kind,role:record.payload.data?.role});}
   const allowed=new Set([...refs(previous),...members.map(m=>m.record_id)]),models=new OverviewModels(await runtimeModels(this.store.env,this.owner));await this.store.recordModelAttempt('scope_summary',JSON.stringify({previous,entries}).length);
   const content=await models.merge(previous,entries,allowed,{kind:scope.kind,title:(await this.store.vault.open(scope.title_cipher,this.owner+':scope-title:'+scope.id) as {title:string}).title});rejectCredentials(content);
   await this.active();const stillCurrent=await this.db.prepare(`SELECT 1 FROM library_scopes s WHERE s.id=? AND s.generation=? AND ${this.scopeFilter()}`).bind(scope.id,scope.generation).first();if(!stillCurrent)throw new ApiError(409,'evidence_version_changed');
   const cursor=members.at(-1)!.seq,more=await this.db.prepare('SELECT 1 FROM library_members WHERE scope_id=? AND seq>? LIMIT 1').bind(scope.id,cursor).first(),now=new Date().toISOString(),revision=scope.revision+1;
   const working=await this.store.vault.seal(content,this.owner+':scope-work:'+scope.id),published=more?scope.payload_cipher:await this.store.vault.seal(content,this.owner+':scope:'+scope.id+':'+revision);
   const result=await this.db.batch([
    this.db.prepare('UPDATE library_scopes SET status=?,cursor=?,covered=covered+?,work_cipher=?,payload_cipher=?,revision=?,error_code=NULL,retry_at=NULL,updated_at=? WHERE id=? AND generation=? AND cursor=?').bind(more?'processing':'ready',cursor,members.length,working,published,more?scope.revision:revision,now,scope.id,scope.generation,scope.cursor),
    this.db.prepare("INSERT OR IGNORE INTO library_summary_versions SELECT id,revision,payload_cipher,updated_at FROM library_scopes WHERE id=? AND generation=? AND status='ready' AND revision=? AND payload_cipher=?").bind(scope.id,scope.generation,revision,published)
   ]);
   if(!result[0].meta.changes)throw new ApiError(409,'evidence_version_changed');
   return {status:more?'processing':'ready',scope_id:scope.id,processed:members.length};
  }catch(e){const code=e instanceof ApiError?e.code:'library_summary_failed';await this.db.prepare("UPDATE library_scopes SET status='failed',error_code=?,attempts=attempts+1,retry_at=? WHERE id=? AND generation=?").bind(code,new Date(Date.now()+300000).toISOString(),scope.id,scope.generation).run();return {status:'failed',scope_id:scope.id,error_code:code};}
 });}
 async process(){this.organizer();const extraction=await this.extract(),summaries=await this.summarize();return {extraction,summaries};}
 async conversationBriefs(sessions:{source_platform:string;session_id:string;conversation_message_records:number}[]){
  need(this.store.principal,'memory:read');
  const result=new Map<string,{id?:string;status:string;brief:string|null;covered:number;total:number;updated_at?:string}>();
  const targets=await Promise.all(sessions.map(async c=>{const key=canonical([c.source_platform,c.session_id]),hash=await this.store.vault.hash('library-scope:'+canonical([this.owner,'conversation',key]));result.set(key,{status:'pending',brief:null,covered:0,total:c.conversation_message_records});return {key,id:'scope_'+hash.slice(0,40),total:c.conversation_message_records};}));
  if(!targets.length)return result;
  const ids=targets.map(t=>t.id),marks=ids.map(()=>'?').join(',');
  const rows=(await this.db.prepare(`SELECT s.* FROM library_scopes s WHERE s.owner_id=? AND s.id IN (${marks}) AND s.kind='conversation' AND ${this.scopeFilter()}`).bind(this.owner,...ids).all<Scope>()).results;
  if(!rows.length)return result;
  // Fetch metadata in one batch; no model calls or source bodies are needed for archive cards.
  const members=(await this.db.prepare(`SELECT scope_id,record_id FROM library_members WHERE scope_id IN (${marks})`).bind(...ids).all<{scope_id:string;record_id:string}>()).results;
  for(const row of rows){const target=targets.find(t=>t.id===row.id)!;let brief:string|null=null;
   if(row.status==='ready'&&row.payload_cipher){const content=await this.store.vault.open(row.payload_cipher,this.owner+':scope:'+row.id+':'+row.revision) as OverviewContent;
    const valid=new Set(members.filter(m=>m.scope_id===row.id).map(m=>m.record_id));if(refs(content).every(id=>valid.has(id)))brief=content.brief||null;
   }
   result.set(target.key,{id:row.id,status:row.status==='ready'&&row.covered<target.total?'partial':row.status,brief,covered:row.covered,total:target.total,updated_at:row.updated_at});
  }
  // Recheck evidence visibility and revisions after decrypting, as with read().
  const current=(await this.db.prepare(`SELECT s.id,s.generation,s.revision FROM library_scopes s WHERE s.owner_id=? AND s.id IN (${marks}) AND ${this.scopeFilter()}`).bind(this.owner,...ids).all<{id:string;generation:number;revision:number}>()).results;
  for(const row of rows)if(!current.some(c=>c.id===row.id&&c.generation===row.generation&&c.revision===row.revision)){const t=targets.find(t=>t.id===row.id)!;result.set(t.key,{status:'pending',brief:null,covered:0,total:t.total});}
  return result;
 }
 async list(input:unknown={}){
  need(this.store.principal,'memory:read');const v=libraryReadSchema.parse(input),args:unknown[]=[this.owner];let where='s.owner_id=?';if(v.kind){where+=' AND s.kind=?';args.push(v.kind);}where+=' AND '+this.scopeFilter();
  const rows=(await this.db.prepare(`SELECT s.*,(SELECT COUNT(*) FROM library_members m WHERE m.scope_id=s.id) total FROM library_scopes s WHERE ${where} ORDER BY s.scope_key DESC,s.id LIMIT ? OFFSET ?`).bind(...args,v.limit+1,v.cursor).all<Scope&{total:number}>()).results;
  const summaries=[];for(const s of rows.slice(0,v.limit)){const title=await this.store.vault.open(s.title_cipher,this.owner+':scope-title:'+s.id) as {title:string};summaries.push({id:s.id,kind:s.kind,key:['day','week','month','category'].includes(s.kind)?s.scope_key:undefined,title:title.title,status:s.status,revision:s.revision,covered:s.covered,total:s.total,updated_at:s.updated_at,error_code:s.error_code});}
  return {summaries,next_cursor:rows.length>v.limit?v.cursor+v.limit:null,timezone:'Asia/Shanghai',week_starts_on:'Monday',coverage:'Uploaded readable evidence only; not full platform account history.'};
 }
 async read(id:string){
  need(this.store.principal,'memory:read');const row=await this.db.prepare(`SELECT s.* FROM library_scopes s WHERE s.id=? AND s.owner_id=? AND ${this.scopeFilter()}`).bind(id,this.owner).first<Scope>();if(!row)throw new ApiError(404,'summary_not_found');
  const title=await this.store.vault.open(row.title_cipher,this.owner+':scope-title:'+row.id) as {title:string};
  const content=row.status==='ready'&&row.payload_cipher?await this.store.vault.open(row.payload_cipher,this.owner+':scope:'+row.id+':'+row.revision) as OverviewContent:null;
  const evidence_index:Record<string,{id:string;version:number}>={};if(content){const used=refs(content);for(let start=0;start<used.length;start+=60){const ids=used.slice(start,start+60),rows=(await this.db.prepare('SELECT record_id,source_version FROM library_members WHERE scope_id=? AND record_id IN ('+ids.map(()=>'?').join(',')+')').bind(id,...ids).all<{record_id:string;source_version:number}>()).results;for(const source of ids){const m=rows.find(r=>r.record_id===source);if(!m)throw new ApiError(409,'summary_evidence_changed');evidence_index[source]={id:source,version:m.source_version};}}}
  if(!await this.db.prepare(`SELECT 1 FROM library_scopes s WHERE s.id=? AND s.generation=? AND s.revision=? AND ${this.scopeFilter()}`).bind(id,row.generation,row.revision).first())throw new ApiError(409,'summary_evidence_changed');
  return {id,kind:row.kind,title:title.title,status:row.status,version:row.revision,updated_at:row.updated_at,overview:content,evidence_index,covered:row.covered,error_code:row.error_code};
 }
 async status(){
  need(this.store.principal,'memory:read');const settings=await this.settings(),where=`r.owner_id=? AND ${this.filter()} AND ${originals}`;
  const counts=await this.db.prepare(`SELECT COUNT(*) total,COALESCE(SUM(l.source_version=r.version AND l.classification_revision=c.revision AND l.extracted=1),0) organized FROM records r LEFT JOIN memory_classifications c ON c.record_id=r.id AND c.owner_id=r.owner_id LEFT JOIN library_labels l ON l.record_id=r.id AND l.owner_id=r.owner_id WHERE ${where}`).bind(this.owner).first<{total:number;organized:number}>();
  const stages=(await this.db.prepare(`SELECT s.status,COUNT(*) count FROM library_scopes s WHERE s.owner_id=? AND ${this.scopeFilter()} GROUP BY s.status`).bind(this.owner).all()).results;
  const failures=(await this.db.prepare(`SELECT x.record_id,x.error_code,x.attempts,x.retry_at FROM library_source_errors x JOIN records r ON r.id=x.record_id WHERE ${where} AND x.source_version=r.version ORDER BY x.retry_at LIMIT 20`).bind(this.owner).all()).results;
  return {enabled:!!settings?.enabled,control_revision:settings?.revision??0,counts,stages,failures,runtime:this.store.env.LIBRARY_WORKFLOW?'Cloudflare Workflows':'local/manual runner',application_model_limit:false,scope_limited:policy(this.store.principal).read_level<3||!this.store.principal.scopes.includes('sensitive:read')||collections.some(c=>!policy(this.store.principal).collections.includes(c))};
 }
 async retry(input:unknown){this.organizer();z.object({authorized:z.literal(true)}).strict().parse(input);await this.db.batch([this.db.prepare('DELETE FROM library_source_errors WHERE owner_id=?').bind(this.owner),this.db.prepare("UPDATE library_scopes SET status='pending',retry_at=NULL,error_code=NULL WHERE owner_id=? AND status='failed'").bind(this.owner)]);return this.status();}
 async insights(){
  const status=await this.status(),where=`r.owner_id=? AND ${this.filter()}`;
  const coverage=(await this.db.prepare(`SELECT r.source_platform,COUNT(*) message_records,COUNT(DISTINCT r.session_id) conversations,MIN(r.source_timestamp) first_at,MAX(r.source_timestamp) last_at FROM records r WHERE ${where} AND r.record_type='message' GROUP BY r.source_platform ORDER BY last_at DESC`).bind(this.owner).all()).results;
  const imports=this.store.principal.scopes.includes('admin')&&policy(this.store.principal).read_level===3&&this.store.principal.scopes.includes('sensitive:read')&&collections.every(c=>policy(this.store.principal).collections.includes(c))?(await this.db.prepare('SELECT id,batch_id,client_id,saved,duplicates,conflicts,received_at FROM library_import_receipts WHERE owner_id=? ORDER BY received_at DESC LIMIT 30').bind(this.owner).all()).results:[];
  const quality=await this.db.prepare(`SELECT COUNT(*) unresolved_conflicts FROM conflicts c JOIN records r ON r.id=c.record_id WHERE c.status='pending' AND ${where}`).bind(this.owner).first();
  const labelRows=(await this.db.prepare(`SELECT l.record_id,l.payload_cipher FROM library_labels l JOIN records r ON r.id=l.record_id JOIN memory_classifications c ON c.record_id=r.id AND c.owner_id=r.owner_id WHERE ${where} AND l.source_version=r.version AND l.classification_revision=c.revision ORDER BY r.updated_at DESC LIMIT 100`).bind(this.owner).all<{record_id:string;payload_cipher:string}>()).results;
  const labels=new Map<string,number>();for(const row of labelRows){const v=await this.store.vault.open(row.payload_cipher,this.owner+':labels:'+row.record_id) as Labels;for(const tag of v.tags)labels.set(tag,(labels.get(tag)??0)+1);}
  return {processing:status,coverage,imports,quality,tags:[...labels].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count),tag_sample:{records:labelRows.length,limit:100,complete:(status.counts?.organized??0)<=100},note:'Coverage is submitted data only. Import receipts begin with this release; historical zero is not proof of no imports.'};
 }
 async overview(input:unknown={}){
  const v=overviewReadSchema.parse(input),counts=await new MemoryOverview(this.store).stats(),state=await this.status(),index=await this.handoff(),content=blank(),evidence_index:Record<string,{id:string;version:number}>={};let version=0,updated_at:string|null=null,ready=0;
  for(const item of index.summaries){if(item.status!=='ready')continue;const value=await this.read(item.id);if(!value.overview)continue;ready++;version+=value.version;updated_at=!updated_at||Date.parse(value.updated_at)>Date.parse(String(updated_at))?value.updated_at:updated_at;Object.assign(evidence_index,value.evidence_index);
   if(item.kind==='category')content.personal.push(...value.overview.personal);
   if(item.kind==='project')content.projects.push(...value.overview.projects);
   if(item.kind==='month'){content.mainline.push(...value.overview.mainline);content.next_actions.push(...value.overview.next_actions);}
  }
  for(const key of ['personal','projects','mainline','next_actions'] as const){const seen=new Set<string>();content[key]=content[key].filter((item:any)=>{const k=canonical(item);if(seen.has(k))return false;seen.add(k);return true;}).slice(0,40) as any;}
  content.brief=[content.personal[0]?.text,content.projects.slice(0,3).map(p=>p.name+'：'+p.current_step).join('；'),content.next_actions[0]?.text].filter(Boolean).join('\n').slice(0,2000);
  const configured=new OverviewModels(await runtimeModels(this.store.env,this.owner)).ready;
  return {strategy:await this.store.strategy(),library:true,version,updated_at,configured,enabled:state.enabled,counts,status:ready?(index.status==='organized'?'ready':'updating'):'not_generated',overview:ready?(v.section!=='all'?{section:v.section,items:content[v.section]}:v.detail==='full'?content:{...content,personal:content.personal.slice(0,3),projects:content.projects.slice(0,3),mainline:content.mainline.slice(0,3),next_actions:content.next_actions.slice(0,3),detail_available:true}):null,evidence_index,coverage:{included_sources:state.counts?.organized??0,available_sources:counts.total_sources,scope:'Uploaded, authorized sources only; bounded handoff with paginated detailed summaries.'},index:{full:'/v1/overview?detail=full',summaries:'/v1/library/summaries',sections:['personal','projects','mainline','next_actions'].map(section=>({section,url:'/v1/overview?detail=full&section='+section}))},composition:'Current authorized category/project/month summaries; not an exhaustive single document.'};
 }
 async handoff(){
  const [status,category,projects,months]=await Promise.all([this.status(),this.list({kind:'category',limit:6}),this.list({kind:'project',limit:8}),this.list({kind:'month',limit:2})]);
  const summaries=[];for(const scope of [...category.summaries,...projects.summaries,...months.summaries]){if(scope.status!=='ready'){summaries.push({...scope,overview:null});continue;}const value=await this.read(scope.id);summaries.push({...scope,brief:value.overview?.brief?.slice(0,700),detail_url:'/v1/library/summaries/'+scope.id});}
  return {status:status.counts?.organized===status.counts?.total&&status.stages.every((s:any)=>s.status==='ready')?'organized':'updating',counts:status.counts,summaries,next_project_cursor:projects.next_cursor,read_more:'/v1/library/summaries',note:'Bounded index of authorized summaries. Pending or missing summaries do not prove an event never happened.'};
 }
}
