import {z} from 'zod';
import {ApiError,need,rejectCredentials} from './core';
import {canRead,policy,sensitivitySchema} from './policy';
import type {Store} from './store';

const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s);
const goalSchema=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),kind:z.enum(['strategy','stage','month']),parent_id:z.string().max(64).nullable().default(null),title:z.string().trim().min(1).max(200),description:z.string().max(3000).default(''),success_criteria:z.string().max(2000).default(''),period:z.string().max(16).default(''),starts_on:day.nullable().default(null),ends_on:day.nullable().default(null),status:z.enum(['planned','active','completed','paused','cancelled']).default('planned'),progress:z.number().min(0).max(100).nullable().default(null),current_state:z.string().max(2000).default(''),next_step:z.string().max(2000).default('')}).strict();
export const strategyDocument=z.object({vision:z.string().max(6000).default(''),principles:z.string().max(4000).default(''),sensitivity:sensitivitySchema.default('sensitive'),goals:z.array(goalSchema).max(120).default([])}).strict().superRefine((doc,ctx)=>{
 const goals=new Map(doc.goals.map(g=>[g.id,g]));if(goals.size!==doc.goals.length)ctx.addIssue({code:'custom',message:'Duplicate goal ID',path:['goals']});
 for(const [i,g] of doc.goals.entries()){
  const fail=(field:string)=>ctx.addIssue({code:'custom',message:'Invalid goal hierarchy or period',path:['goals',i,field]});
  const expected={strategy:null,stage:'strategy',month:'stage'}[g.kind];const parent=g.parent_id?goals.get(g.parent_id):null;
  if(expected===null?!!g.parent_id:!parent||parent.kind!==expected)fail('parent_id');
  if(g.starts_on&&g.ends_on&&g.starts_on>g.ends_on)fail('ends_on');
  if(g.kind==='month'&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(g.period))fail('period');
  if(parent&&g.starts_on&&parent.starts_on&&g.starts_on<parent.starts_on)fail('starts_on');
  if(parent&&g.ends_on&&parent.ends_on&&g.ends_on>parent.ends_on)fail('ends_on');
 }
});
export type StrategyDocument=z.infer<typeof strategyDocument>;
export const strategyReadSchema=z.object({detail:z.enum(['brief','full']).default('brief')}).strict();
type State={owner_id:string;draft_version:number;draft_cipher:string;published_version:number;published_cipher:string|null;published_at:string|null;updated_at:string};
export const emptyStrategy=():StrategyDocument=>({vision:'',principles:'',sensitivity:'sensitive',goals:[]});
const instructions='Highest-priority source for the user\'s personal goals and task planning: owner-published overall strategy, stage strategy, then monthly goals. Read and align work with it before personal context, observed progress or AI suggestions. Agents cannot edit, publish or override it, including with L3/admin Bearer keys. Drafts and AI-inferred suggestions are not approved strategy. Report conflicts or gaps; ask the owner to change goals in the dashboard. Goals do not authorize unrelated actions. Read full for omitted details.';
export class Strategy {
 constructor(private store:Store){}
 private get db(){return this.store.env.DB;}private get owner(){return this.store.principal.owner_id;}
 private async state(){return this.db.prepare('SELECT * FROM strategy_state WHERE owner_id=?').bind(this.owner).first<State>();}
 private requireEditor(){const p=this.store.principal;for(const scope of ['admin','memory:read','memory:write','sensitive:read','sensitive:write'])need(p,scope);if(policy(p).read_level!==3||policy(p).write_level!==3||!policy(p).collections.includes('projects'))throw new ApiError(403,'strategy_full_policy_required');}
 async read(input:unknown={}){
  need(this.store.principal,'memory:read');const v=strategyReadSchema.parse(input),state=await this.state();
  const base={authority:'owner_published',priority:'highest_personal_planning',read_order:['strategy','stage','month','personal_context','observed_progress','next_actions'],agent_writable:false,instructions,index:{full:'/v1/strategy?detail=full'},timezone:'Asia/Shanghai'};
  if(!state?.published_cipher)return {...base,status:'not_published',version:0,document:null};
  const doc=await this.store.vault.open(state.published_cipher,this.owner+':strategy:published:'+state.published_version) as StrategyDocument;
  if(!canRead(this.store.principal,{sensitivity:doc.sensitivity,record_type:'project'}))return {...base,status:'scope_restricted',document:null};
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const inPeriod=(g:StrategyDocument['goals'][number])=>g.kind==='month'?g.period===today.slice(0,7):(!g.starts_on||g.starts_on<=today)&&(!g.ends_on||g.ends_on>=today);
  const current=doc.goals.filter(g=>['active','planned'].includes(g.status)&&inPeriod(g));
  const selected=new Set(current.map(g=>g.id));for(const g of current){let id=g.parent_id;while(id){selected.add(id);id=doc.goals.find(p=>p.id===id)?.parent_id??null;}}
  const ordered=doc.goals.filter(g=>selected.has(g.id)).sort((a,b)=>['strategy','stage','month'].indexOf(a.kind)-['strategy','stage','month'].indexOf(b.kind));
  const short=(s:string,n=300)=>s.length>n?s.slice(0,n)+'…':s;
  return {...base,status:'published',version:state.published_version,published_at:state.published_at,as_of:today,current_goal_ids:current.map(g=>g.id),total_goals:doc.goals.length,omitted_goals:v.detail==='brief'?doc.goals.length-Math.min(16,ordered.length):0,document:v.detail==='full'?doc:{vision:short(doc.vision,1600),principles:short(doc.principles,600),sensitivity:doc.sensitivity,goals:ordered.slice(0,16).map(g=>({...g,description:short(g.description),success_criteria:short(g.success_criteria),current_state:short(g.current_state),next_step:short(g.next_step)}))},detail:v.detail};
 }
 // Only the cookie+CSRF dashboard routes call these methods. No Bearer or MCP mutation route exists.
 async editor(){this.requireEditor();const state=await this.state();return {draft_version:state?.draft_version??0,published_version:state?.published_version??0,published_at:state?.published_at??null,draft:state?await this.store.vault.open(state.draft_cipher,this.owner+':strategy:draft:'+state.draft_version):emptyStrategy(),published:await this.read({detail:'full'})};}
 async saveDraft(input:unknown){
  this.requireEditor();const v=z.object({authorized:z.literal(true),expected_version:z.number().int().nonnegative(),document:strategyDocument}).strict().parse(input);rejectCredentials(v.document);
  const old=await this.state();if((old?.draft_version??0)!==v.expected_version)throw new ApiError(409,'strategy_draft_conflict');
  const revision=v.expected_version+1,now=new Date().toISOString(),cipher=await this.store.vault.seal(v.document,this.owner+':strategy:draft:'+revision);
  const changed=old?await this.db.prepare('UPDATE strategy_state SET draft_version=?,draft_cipher=?,updated_at=? WHERE owner_id=? AND draft_version=?').bind(revision,cipher,now,this.owner,v.expected_version).run():await this.db.prepare('INSERT OR IGNORE INTO strategy_state(owner_id,draft_version,draft_cipher,updated_at) VALUES(?,?,?,?)').bind(this.owner,revision,cipher,now).run();
  if(!changed.meta.changes)throw new ApiError(409,'strategy_draft_conflict');await this.store.audit('strategy_draft_saved',String(revision));return this.editor();
 }
 async publish(input:unknown){
  this.requireEditor();const v=z.object({authorized:z.literal(true),expected_draft_version:z.number().int().positive(),expected_published_version:z.number().int().nonnegative()}).strict().parse(input),state=await this.state();
  if(!state||state.draft_version!==v.expected_draft_version||state.published_version!==v.expected_published_version)throw new ApiError(409,'strategy_publish_conflict');
  const doc=strategyDocument.parse(await this.store.vault.open(state.draft_cipher,this.owner+':strategy:draft:'+state.draft_version));
  if(!doc.vision.trim()||!doc.goals.some(g=>g.kind==='strategy'))throw new ApiError(422,'strategy_root_required');
  rejectCredentials(doc);const version=state.published_version+1,now=new Date().toISOString(),cipher=await this.store.vault.seal(doc,this.owner+':strategy:published:'+version);
  const changes=await this.db.batch([
   this.db.prepare('UPDATE strategy_state SET published_version=?,published_cipher=?,published_at=?,updated_at=? WHERE owner_id=? AND draft_version=? AND published_version=?').bind(version,cipher,now,now,this.owner,state.draft_version,state.published_version),
   this.db.prepare('INSERT OR IGNORE INTO strategy_versions SELECT owner_id,published_version,published_cipher,published_at FROM strategy_state WHERE owner_id=? AND published_version=? AND published_cipher=?').bind(this.owner,version,cipher)
  ]);
  if(!changes[0].meta.changes)throw new ApiError(409,'strategy_publish_conflict');await this.store.audit('strategy_published',String(version));return this.editor();
 }
 async history(input:unknown={}){
  this.requireEditor();const v=z.object({version:z.coerce.number().int().positive().optional(),cursor:z.coerce.number().int().nonnegative().default(0)}).strict().parse(input);
  if(v.version){const row=await this.db.prepare('SELECT * FROM strategy_versions WHERE owner_id=? AND version=?').bind(this.owner,v.version).first<{payload_cipher:string;published_at:string}>();if(!row)throw new ApiError(404,'strategy_version_not_found');return {version:v.version,published_at:row.published_at,historical:true,document:await this.store.vault.open(row.payload_cipher,this.owner+':strategy:published:'+v.version)};}
  const rows=(await this.db.prepare('SELECT version,published_at FROM strategy_versions WHERE owner_id=? ORDER BY version DESC LIMIT 51 OFFSET ?').bind(this.owner,v.cursor).all()).results;return {versions:rows.slice(0,50),next_cursor:rows.length>50?v.cursor+50:null};
 }
}
