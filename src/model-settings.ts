import {z} from 'zod';
import {ApiError,Env,Principal,Vault,need} from './core';
import {ModelConfig,modelList} from './models';
const schema=z.object({authorized:z.literal(true),expected_version:z.number().int().nonnegative(),base_url:z.string().max(500),model:z.string().max(200),api_key:z.string().min(1).max(4096).optional(),siliconflow_api_key:z.string().min(1).max(4096).optional(),summary_enabled:z.boolean(),retrieval_enabled:z.boolean()}).strict();
type Settings={base_url:string;model:string;api_key?:string;siliconflow_api_key?:string;summary_enabled:boolean;retrieval_enabled:boolean};
export async function readSettings(env:Env,owner:string){
 const row=await env.DB.prepare('SELECT payload_cipher,version,updated_at FROM model_settings WHERE owner_id=?').bind(owner).first<{payload_cipher:string;version:number;updated_at:string}>();
 if(!row)return null;
 return {settings:await new Vault(env.ENCRYPTION_KEY).open(row.payload_cipher,owner+':model-settings') as Settings,version:row.version,updated_at:row.updated_at};
}
export async function runtimeModels(env:Env,owner:string):Promise<ModelConfig&{retrievalEnabled:boolean}>{
 const saved=await readSettings(env,owner);if(!saved)return {...env,retrievalEnabled:env.RAG_ENABLED==='true'};
 const s=saved.settings;return {SILICONFLOW_API_KEY:s.retrieval_enabled?(s.siliconflow_api_key??env.SILICONFLOW_API_KEY):undefined,SUMMARY_API_KEY:s.summary_enabled?(s.api_key??(s.base_url===env.SUMMARY_BASE_URL?env.SUMMARY_API_KEY:undefined)):undefined,SUMMARY_BASE_URL:s.base_url,SUMMARY_MODEL:s.model,retrievalEnabled:env.RAG_ENABLED==='true'&&s.retrieval_enabled};
}
export class ModelSettings {
 constructor(private env:Env,private principal:Principal){need(principal,'admin');}
 async metadata(){const saved=await readSettings(this.env,this.principal.owner_id),s=saved?.settings;return {version:saved?.version??0,updated_at:saved?.updated_at??null,base_url:s?.base_url??this.env.SUMMARY_BASE_URL??'https://api.example.com/v1',model:s?.model??this.env.SUMMARY_MODEL??'',api_key_configured:!!(s?.api_key??((!s||s.base_url===this.env.SUMMARY_BASE_URL)?this.env.SUMMARY_API_KEY:undefined)),siliconflow_key_configured:!!(s?.siliconflow_api_key??this.env.SILICONFLOW_API_KEY),summary_enabled:s?.summary_enabled??true,retrieval_enabled:s?.retrieval_enabled??true};}
 async save(input:unknown){
  const v=schema.parse(input),old=await readSettings(this.env,this.principal.owner_id);
  if(v.expected_version!==(old?.version??0))throw new ApiError(409,'model_settings_conflict');
  const next:Settings={base_url:v.base_url.replace(/\/$/,''),model:v.model,api_key:v.api_key??(v.base_url.replace(/\/$/,'')===old?.settings.base_url?old.settings.api_key:undefined),siliconflow_api_key:v.siliconflow_api_key??old?.settings.siliconflow_api_key,summary_enabled:v.summary_enabled,retrieval_enabled:v.retrieval_enabled};
  if(next.base_url)validateEndpoint(next.base_url);
  if([next.api_key,next.siliconflow_api_key,next.model].some(s=>s&&/[\u0000-\u001f]/.test(s)))throw new ApiError(400,'invalid_model_settings');
  if(next.summary_enabled&&(!next.base_url||!next.model||!(next.api_key??(next.base_url===this.env.SUMMARY_BASE_URL?this.env.SUMMARY_API_KEY:undefined))))throw new ApiError(400,'summary_settings_incomplete');
  const now=new Date().toISOString(),cipher=await new Vault(this.env.ENCRYPTION_KEY).seal(next,this.principal.owner_id+':model-settings');
  const result=old?await this.env.DB.prepare('UPDATE model_settings SET payload_cipher=?,version=version+1,updated_at=? WHERE owner_id=? AND version=?').bind(cipher,now,this.principal.owner_id,v.expected_version).run():await this.env.DB.prepare('INSERT OR IGNORE INTO model_settings VALUES(?,?,1,?)').bind(this.principal.owner_id,cipher,now).run();
  if(!result.meta.changes)throw new ApiError(409,'model_settings_conflict');return this.metadata();
 }
 async list(input:unknown){
  const v=z.object({base_url:z.string().min(1).max(500),api_key:z.string().min(1).max(4096).optional()}).strict().parse(input);validateEndpoint(v.base_url);
  const old=await readSettings(this.env,this.principal.owner_id),key=v.api_key??(old?.settings.base_url===v.base_url.replace(/\/$/,'')?old.settings.api_key:undefined)??(this.env.SUMMARY_BASE_URL===v.base_url.replace(/\/$/,'')?this.env.SUMMARY_API_KEY:undefined);
  // Never send a saved key to a newly entered endpoint without explicit key entry.
  if(!key)throw new ApiError(400,'model_key_required');
  try{return {models:await modelList(v.base_url,key)};}
  catch(e){
   if(e instanceof ApiError){
    const d=e.details as {upstream_status?:number;reason?:string;redirect_kind?:string},suffix=(Number.isInteger(d.upstream_status)?':http_'+d.upstream_status:['not_json','model_list_schema'].includes(d.reason??'')?':'+d.reason:'')+(['non_https','unsafe_url','other_origin','same_url','same_origin','invalid'].includes(d.redirect_kind??'')?':'+d.redirect_kind:'');
    // Fixed error codes only: never log URLs, keys, headers, vendor bodies, or model IDs.
    await this.env.DB.prepare('INSERT INTO audit_log VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),this.principal.owner_id,this.principal.id,'model_list_failed',e.code+suffix,new Date().toISOString()).run();
   }
   throw e;
  }
 }
}
export function validateEndpoint(value:string){
 let u:URL;try{u=new URL(value);}catch{throw new ApiError(400,'invalid_model_endpoint');}
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||!u.hostname.includes('.')||u.hostname.endsWith('.local')||u.hostname.endsWith('.localhost')||/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)||u.hostname.includes(':'))throw new ApiError(400,'invalid_model_endpoint');
 return u;
}
