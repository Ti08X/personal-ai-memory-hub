import {ApiError, authenticate, authorizeClient, Env, Principal, Vault} from './core';
const lifetime=1800;
const cookieName=(req:Request)=>new URL(req.url).protocol==='https:'?'__Host-pmh_session':'pmh_dev_session';
export function sessionCookie(req:Request,value:string,maxAge=lifetime){return `${cookieName(req)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(req.url).protocol==='https:'?'; Secure':''}`;}
export function sameOrigin(req:Request){if(req.headers.get('origin')!==new URL(req.url).origin)throw new ApiError(403,'same_origin_required');}
type Claims={session_id:string;client_id:string;expires:number;csrf:string};
export async function createSession(req:Request,env:Env){
 sameOrigin(req);const principal=await authenticate(req,env);return createSessionFor(req,env,principal);
}
export async function createSessionFor(req:Request,env:Env,principal:Principal,passwordHash?:string){
 sameOrigin(req);
 const claims:Claims={session_id:crypto.randomUUID(),client_id:principal.id,expires:Date.now()+lifetime*1000,csrf:crypto.randomUUID()};
 const value=await new Vault(env.ENCRYPTION_KEY).seal(claims,'dashboard-session-v1');
 const values=[claims.session_id,principal.id,principal.owner_id,new Date().toISOString(),new Date(claims.expires).toISOString()];
 const inserted=passwordHash
  ?await env.DB.prepare('INSERT INTO dashboard_sessions SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM dashboard_auth WHERE client_id=? AND owner_id=? AND password_hash=?)').bind(...values,principal.id,principal.owner_id,passwordHash).run()
  :await env.DB.prepare('INSERT INTO dashboard_sessions VALUES(?,?,?,?,?)').bind(...values).run();
 if((inserted.meta?.changes??0)!==1)throw new ApiError(401,'password_changed_login_again');
 return {principal,claims,cookie:sessionCookie(req,value)};
}
export async function readSession(req:Request,env:Env,csrfRequired=false):Promise<{principal:Principal;claims:Claims;name:string}>{
 const site=req.headers.get('sec-fetch-site');if(site&&site!=='same-origin'&&site!=='none')throw new ApiError(403,'same_origin_required');
 const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)throw new ApiError(403,'same_origin_required');
 const value=req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName(req)+'='))?.slice(cookieName(req).length+1);
 if(!value||value.length>4096)throw new ApiError(401,'dashboard_login_required');
 let claims:Claims;
 try{claims=await new Vault(env.ENCRYPTION_KEY).open(value,'dashboard-session-v1') as Claims;}catch{throw new ApiError(401,'invalid_dashboard_session');}
 if(!claims||typeof claims.session_id!=='string'||typeof claims.client_id!=='string'||typeof claims.csrf!=='string'||typeof claims.expires!=='number'||claims.expires<=Date.now())throw new ApiError(401,'expired_dashboard_session');
 if(csrfRequired){sameOrigin(req);if(req.headers.get('x-csrf-token')!==claims.csrf)throw new ApiError(403,'csrf_required');}
 const row=await env.DB.prepare('SELECT c.id,c.owner_id,c.scopes,c.name FROM clients c JOIN dashboard_sessions s ON s.client_id=c.id AND s.owner_id=c.owner_id WHERE c.id=? AND s.id=? AND c.revoked_at IS NULL AND c.expires_at>? AND s.expires_at>?').bind(claims.client_id,claims.session_id,new Date().toISOString(),new Date().toISOString()).first<{id:string;owner_id:string;scopes:string;name:string}>();
 if(!row)throw new ApiError(401,'invalid_or_expired_client');
 const principal=await authorizeClient(env,row);if(row.name==='dashboard-login-service')principal.policy={read_level:3,write_level:3,collections:['chats','memories','accounts','knowledge','projects']};
 return {principal,claims,name:row.name};
}
