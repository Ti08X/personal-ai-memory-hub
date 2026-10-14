import {z} from 'zod';
import type {Principal} from './core';
export const sensitivitySchema=z.enum(['public','normal','sensitive','restricted']);
export const collections=['chats','memories','accounts','knowledge','projects'] as const;
export const policySchema=z.object({read_level:z.number().int().min(0).max(3),write_level:z.number().int().min(0).max(3),collections:z.array(z.enum(collections)).max(5)}).strict();
export type Policy=z.infer<typeof policySchema>;
export const level=(s:string)=>({public:0,normal:1,sensitive:2,restricted:3}[s]??3);
export const sensitivity=(n:number)=>['public','normal','sensitive','restricted'][n];
export function policy(p:Principal):Policy{return p.policy??{read_level:p.scopes.includes('sensitive:read')?2:1,write_level:p.scopes.includes('sensitive:write')?2:1,collections:[...collections]};}
export function collection(r:{record_type?:string;logical_key?:string|null}){return r.record_type==='message'?'chats':r.logical_key?.startsWith('accounts.')?'accounts':r.logical_key?.startsWith('knowledge.')?'knowledge':['project','task'].includes(r.record_type??'')?'projects':'memories';}
export function canRead(p:Principal,r:{sensitivity:string;record_type?:string;logical_key?:string|null}){return level(r.sensitivity)<=policy(p).read_level&&(level(r.sensitivity)<2||p.scopes.includes('sensitive:read'))&&policy(p).collections.includes(collection(r));}
export function canWrite(p:Principal,r:{sensitivity:string;record_type?:string;logical_key?:string|null}){return level(r.sensitivity)<=policy(p).write_level&&(level(r.sensitivity)<2||p.scopes.includes('sensitive:write'))&&policy(p).collections.includes(collection(r));}
export function visibility(p:Principal,alias=''){
 const a=alias,allowed=policy(p).collections.map(c=>"'"+c+"'").join(',')||"''";
 const max=Math.min(policy(p).read_level,p.scopes.includes('sensitive:read')?3:1);
 const sensitivities=['public','normal','sensitive','restricted'].slice(0,max+1).map(s=>"'"+s+"'").join(',');
 return `${a}sensitivity IN (${sensitivities}) AND (CASE WHEN ${a}record_type='message' THEN 'chats' WHEN ${a}logical_key LIKE 'accounts.%' THEN 'accounts' WHEN ${a}logical_key LIKE 'knowledge.%' THEN 'knowledge' WHEN ${a}record_type IN ('project','task') THEN 'projects' ELSE 'memories' END) IN (${allowed})`;
}
