import { z } from 'zod';
import {sensitivitySchema, type Policy} from './policy';

export interface Env extends Omit<WorkerBindings,'LIBRARY_WORKFLOW'|'VECTOR_INDEX'|'RAG_ENABLED'|'MODEL_CALLS_PER_DAY'|'SUMMARY_BASE_URL'|'SUMMARY_MODEL'> { ENCRYPTION_KEY:string; ALLOWED_ORIGINS?:string; SILICONFLOW_API_KEY?:string; SUMMARY_API_KEY?:string; SUMMARY_BASE_URL?:string; SUMMARY_MODEL?:string; RAG_ENABLED?:string; MODEL_CALLS_PER_DAY?:string; VECTOR_INDEX?:Vectorize; LIBRARY_WORKFLOW?:Workflow<{owner:string;client:string}> }
export interface Principal { id:string; owner_id:string; scopes:string[]; policy?:Policy }
export class ApiError extends Error {
 constructor(public status:number, public code:string, public details:unknown={}) { super(code); }
}
const str = (max:number) => z.string().min(1).max(max);
const date = z.string().datetime({offset:true}).transform(v=>new Date(v).toISOString());
export const saveSchema = z.object({
 authorized:z.literal(true), record_type:z.enum(['memory','profile','event','context','summary','project','task']).default('memory'),
 logical_key:str(160).optional(), source_platform:str(64), session_id:z.string().max(160).default(''),
 source_record_id:str(200).optional(), source_kind:z.enum(['direct_user','assistant_summary','imported_document','test']),
 timestamp:date, title:z.string().max(240).default(''), text:str(12000),
 data:z.record(z.string(),z.unknown()).optional(), tags:z.array(str(64)).max(24).default([]),
 confidence:z.number().min(0).max(1).default(1), sensitivity:sensitivitySchema.default('normal'),
 evidence:z.array(z.object({id:str(100),version:z.number().int().positive()}).strict()).max(30).optional(),
 expected_version:z.number().int().min(1).optional(), conflict_id:str(100).optional()
}).strict().refine(v=>v.record_type!=='profile'||!!v.logical_key,{message:'profile requires logical_key'});
const messageSchema = z.object({
 id:str(200), role:z.enum(['user','assistant','system','tool']), timestamp:date,
 content:z.string().max(18000), raw:z.record(z.string(),z.unknown()).optional(),
 sensitivity:sensitivitySchema.default('normal'), expected_version:z.number().int().min(1).optional(), conflict_id:str(100).optional()
}).strict();
export const importSchema = z.object({
 authorized:z.literal(true), source_platform:str(64), session_id:str(160),
 title:z.string().max(240).default(''), completeness:z.enum(['full','partial','summary']),
 messages:z.array(messageSchema).min(1).max(10),
 raw_metadata:z.record(z.string(),z.unknown()).optional()
}).strict();
export const contextSchema = z.object({since:date.optional(),limit:z.number().int().min(1).max(50).default(20),session_id:str(160).optional(),source_platform:str(64).optional(),include_conversation:z.boolean().default(false)}).strict();
export const searchSchema = z.object({query:z.string().min(2).max(120),limit:z.number().int().min(1).max(50).default(20),record_type:z.enum(['memory','profile','event','context','summary','message','project','task']).optional(),collection:z.enum(['accounts','knowledge','memories','chats','projects']).optional(),category:z.enum(['personal','development','work','health','learning','other','unclassified']).optional(),cursor:z.number().int().min(0).default(0),mode:z.enum(['keyword','semantic','hybrid']).default('keyword'),rerank:z.boolean().default(true)}).strict();
export const scopes = ['memory:read','memory:write','conversation:import','sensitive:read','sensitive:write','admin'] as const;
export function need(p:Principal,scope:string) { if(!p.scopes.includes(scope)) throw new ApiError(403,'insufficient_scope',{required:scope}); }
export const canonical = (v:unknown):string => {
 if(Array.isArray(v)) return '['+v.map(canonical).join(',')+']';
 if(v && typeof v==='object') return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';
 return JSON.stringify(v)??'null';
};
const enc = new TextEncoder(); const dec = new TextDecoder();
const bytes64 = (s:string) => Uint8Array.from(atob(s),v=>v.charCodeAt(0));
const base64 = (b:Uint8Array) => btoa(Array.from(b,v=>String.fromCharCode(v)).join(''));
export async function tokenHash(token:string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(token))),v=>v.toString(16).padStart(2,'0')).join(''); }
export class Vault {
 private keys?:Promise<{aes:CryptoKey;mac:CryptoKey}>;
 constructor(private secret:string) {}
 private async getKeys() {
  if(!this.keys) this.keys=(async()=>{
   let raw:Uint8Array; try { raw=bytes64(this.secret); } catch { throw new ApiError(503,'encryption_not_configured'); }
   if(raw.length!==32) throw new ApiError(503,'encryption_not_configured');
   const master=await crypto.subtle.importKey('raw',raw,{name:'HKDF'},false,['deriveKey']);
   const args=(info:string)=>({name:'HKDF',hash:'SHA-256',salt:enc.encode('personal-ai-memory-hub-v1'),info:enc.encode(info)});
   return {aes:await crypto.subtle.deriveKey(args('payload'),master,{name:'AES-GCM',length:256},false,['encrypt','decrypt']),mac:await crypto.subtle.deriveKey(args('blind-search'),master,{name:'HMAC',hash:'SHA-256',length:256},false,['sign'])};
  })();
  return this.keys;
 }
 async seal(value:unknown,aad:string) { const k=await this.getKeys();const iv=crypto.getRandomValues(new Uint8Array(12));const body=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(aad)},k.aes,enc.encode(canonical(value))));return 'v1.'+base64(iv)+'.'+base64(body); }
 async open(value:string,aad:string) { try { const [v,iv,data]=value.split('.');if(v!=='v1')throw new Error();return JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes64(iv),additionalData:enc.encode(aad)},(await this.getKeys()).aes,bytes64(data)))); } catch { throw new ApiError(503,'encrypted_payload_unavailable'); } }
 async hash(value:string) { const result=new Uint8Array(await crypto.subtle.sign('HMAC',(await this.getKeys()).mac,enc.encode(value)));return Array.from(result,v=>v.toString(16).padStart(2,'0')).join(''); }
 async tokens(text:string) {
  const chars=Array.from(normalize(text));const grams=new Set<string>();
  for(let i=0;i<chars.length-1;i++){grams.add(chars[i]+chars[i+1]);if(grams.size>16000)throw new ApiError(413,'search_index_too_large',{hint:'split_into_smaller_records'});}
  const result:string[]=[];for(const gram of grams)result.push('h'+(await this.hash('gram:'+gram)).slice(0,32));
  return result.sort().join(' ');
 }
}
export const normalize=(v:string)=>v.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g,' ').trim();
export function rejectCredentials(value:unknown) {
 const text=canonical(value);
 if(/\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|pmh_[A-Fa-f0-9]{64}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b|[?&]X-Amz-Signature=[A-Fa-f0-9]{32,}|Bearer\s+[A-Za-z0-9._~-]{16,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(text)||/(?:auth_token|ct0|password|api[_-]?key|access[_-]?token)["']?\s*[:=]\s*["']?[^\s"'`,;{}]{12,}/i.test(text)) throw new ApiError(422,'credential_like_content_rejected');
 if(enc.encode(text).length>250000)throw new ApiError(413,'payload_too_large');
}
export async function authenticate(req:Request,env:Env):Promise<Principal> {
 const token=req.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
 if(!token || token.length<32)throw new ApiError(401,'authentication_required');
 const row=await env.DB.prepare('SELECT id,owner_id,scopes FROM clients WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').bind(await tokenHash(token),new Date().toISOString()).first<{id:string;owner_id:string;scopes:string}>();
 if(!row)throw new ApiError(401,'invalid_or_expired_token');
 return authorizeClient(env,row);
}
export async function authorizeClient(env:Env,row:{id:string;owner_id:string;scopes:string}):Promise<Principal> {
 const bucket=Math.floor(Date.now()/60000);
 const rate=await env.DB.prepare('INSERT INTO rate_limits(client_id,bucket,count) VALUES(?,?,1) ON CONFLICT(client_id,bucket) DO UPDATE SET count=count+1 RETURNING count').bind(row.id,bucket).first<{count:number}>();
 if((rate?.count??999)>120)throw new ApiError(429,'rate_limit_exceeded');
 const extra=await env.DB.prepare('SELECT policy_json FROM clients WHERE id=?').bind(row.id).first<{policy_json:string|null}>();
 await env.DB.prepare('UPDATE clients SET last_used_at=? WHERE id=?').bind(new Date().toISOString(),row.id).run();
 return {...row,scopes:JSON.parse(row.scopes),...(extra?.policy_json?{policy:JSON.parse(extra.policy_json)}:{})};
}
