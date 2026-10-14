import {z} from 'zod';
import {ApiError,Env,Principal,canonical,need,Vault} from './core';
const count=z.number().int().min(0).max(100000000);
const schema=z.object({authorized:z.literal(true),event_id:z.string().regex(/^[a-f0-9]{64}$/),timestamp:z.string().datetime({offset:true}),plugin_version:z.string().regex(/^\d+\.\d+\.\d+$/),
 phase:z.enum(['recall','archive','summary','sync']),state:z.enum(['success','pending','conflict','failed','skipped']),session_ref:z.string().regex(/^[a-f0-9]{64}$|^$/),
 code:z.enum(['none','network_error','authentication_required','record_policy_denied','memory_conflict','rate_limited','not_found','hub_unavailable','invalid_response','response_too_large','invalid_cursor','missing_turn_identity','missing_turn_boundary','missing_source_timestamp','hub_upgrade_required','write_verification_failed','destination_changed','state_unreadable','local_sync_error']),
 counts:z.object({read:count.optional(),archived:count.optional(),verified:count.optional(),pending:count.optional(),derived:count.optional()}).strict()}).strict();
export async function saveActivity(env:Env,p:Principal,input:unknown){
 need(p,'memory:write');const v=schema.parse(input),vault=new Vault(env.ENCRYPTION_KEY),id='integration_'+await vault.hash([p.owner_id,p.id,v.event_id].join(':'));
 const target=canonical({phase:v.phase,state:v.state,code:v.code,counts:v.counts,session_ref:v.session_ref,plugin_version:v.plugin_version});
 const old=await env.DB.prepare('SELECT target_id FROM audit_log WHERE id=? AND owner_id=? AND client_id=?').bind(id,p.owner_id,p.id).first<{target_id:string}>();if(old&&old.target_id!==target)throw new ApiError(409,'activity_conflict');
 await env.DB.prepare('INSERT OR IGNORE INTO audit_log VALUES(?,?,?,?,?,?)').bind(id,p.owner_id,p.id,'integration_activity',target,v.timestamp).run();return {saved:true,deduplicated:!!old};
}
export async function listActivity(env:Env,p:Principal,input:unknown){
 need(p,'memory:read');const v=z.object({limit:z.coerce.number().int().min(1).max(100).default(50)}).strict().parse(input),admin=p.scopes.includes('admin');
 const rows=(await env.DB.prepare('SELECT a.id,a.client_id,a.target_id,a.timestamp,c.name FROM audit_log a LEFT JOIN clients c ON c.id=a.client_id AND c.owner_id=a.owner_id WHERE a.owner_id=? AND a.action=?'+(admin?'':' AND a.client_id=?')+' ORDER BY a.timestamp DESC,a.id DESC LIMIT ?').bind(p.owner_id,'integration_activity',...(admin?[]:[p.id]),v.limit).all<{id:string;client_id:string;target_id:string;timestamp:string;name:string}>()).results;
 return {owner_ref:await new Vault(env.ENCRYPTION_KEY).hash(p.owner_id),events:rows.map(({target_id,...row})=>({...row,...JSON.parse(target_id)})),scope:admin?'owner_clients':'this_client',coverage:'Client-reported activity, not proof that every account or session was collected.'};
}
