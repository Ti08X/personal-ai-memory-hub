import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,createHmac} from 'node:crypto';
import {localTestConfig} from '../scripts/local-test-config.mjs';

const browserModule=process.env.LOGIN_BROWSER_MODULE??process.env.PLAYWRIGHT_MODULE;
const project=new URL('..',import.meta.url).pathname,run=promisify(execFile);
function codeFor(secret,step){
 let bits=0,value=0,bytes=[];
 for(const c of secret){value=(value<<5)|'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c);bits+=5;if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8;}}
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));
 const digest=createHmac('sha1',Buffer.from(bytes)).update(counter).digest(),offset=digest.at(-1)&15;
 return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}

test('real browser enters the workspace after TOTP, restores on refresh, and shows replay errors',{
 skip:!browserModule,timeout:90000
},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pmh-login-browser-'));await chmod(dir,0o700);
 const base='http://localhost:8793',state=join(dir,'state');let server,browser;
 try{
  const configPath=await localTestConfig(dir),wrangler=join(project,'node_modules/wrangler/bin/wrangler.js');
  const cli=args=>run(process.execPath,[wrangler,'--config',configPath,...args],{cwd:project,env:{...process.env,CI:'1'},maxBuffer:2000000});
  await run(process.execPath,['scripts/bootstrap.mjs',dir],{cwd:project});
  await cli(['d1','migrations','apply','personal-ai-memory-hub','--local','--persist-to',state]);
  await cli(['d1','execute','personal-ai-memory-hub','--local','--persist-to',state,'--file',join(dir,'bootstrap.sql'),'--yes']);
  const config=JSON.parse(await readFile(join(dir,'credentials.json'),'utf8'));
  server=spawn(process.execPath,[wrangler,'--config',configPath,'dev','--host','localhost','--port','8793','--persist-to',state,'--env-file',join(dir,'worker.env')],{cwd:project,stdio:'ignore',env:{...process.env,CI:'1'}});
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(ready);
  const password=randomBytes(24).toString('base64url');
  const post=async(path,data,token)=>fetch(base+'/ui/auth/'+path,{method:'POST',headers:{origin:base,'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});
  const started=await post('setup/start',{username:'synthetic-login',password},config.clients.admin.token);assert.equal(started.status,200);
  const {secret}=await started.json();
  const enrolled=await post('setup/confirm',{code:codeFor(secret,Math.floor(Date.now()/30000)-1)});assert.equal(enrolled.status,200);
  const {recovery_codes:recovery}=await enrolled.json();
  const {chromium}=await import(browserModule);
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  const context=await browser.newContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.name));
  await page.goto(base+'/dashboard');
  const startLogin=async()=>{
   await page.locator('#auth-login-form').waitFor({state:'visible'});
   await page.locator('#auth-username').fill('synthetic-login');await page.locator('#auth-password').fill(password);
   await page.locator('#auth-login-form button').click();await page.locator('#auth-code-form').waitFor({state:'visible'});
  };
  const submitCode=async(code)=>{
   await page.locator('#auth-code').fill(code);
   const response=page.waitForResponse(r=>r.url().endsWith('/ui/auth/verify'));
   await page.locator('#auth-code-form button').click();return response;
  };
  await startLogin();
  const usedCode=codeFor(secret,Math.floor(Date.now()/30000)),verified=await submitCode(usedCode);
  assert.equal(verified.status(),200);
  await page.locator('#workspace').waitFor({state:'visible',timeout:3000});
  await page.locator('#content .overview-hero').waitFor({state:'visible',timeout:3000});
  const session=await (await context.request.get(base+'/ui/session')).json();
  assert.ok(Math.abs(Date.parse(session.expires_at)-(Date.now()+7*24*60*60*1000))<5000);
  // Strategy uses the real password+TOTP owner session, while all agent Bearer paths stay read-only.
  await page.locator('[data-view="strategy"]').click();await page.locator('.strategy-editor').waitFor();
  await page.getByLabel('总战略总述',{exact:true}).fill('合成战略：让工作有方向且可回溯。');
  await page.getByRole('button',{name:'＋ 总战略',exact:true}).click();await page.locator('.strategy-edit-goal[data-kind="strategy"]').getByLabel('目标标题',{exact:true}).fill('合成长期方向');
  await page.getByRole('button',{name:'＋ 阶段战略',exact:true}).click();await page.locator('.strategy-edit-goal[data-kind="stage"]').getByLabel('目标标题',{exact:true}).fill('合成第一阶段');
  await page.getByRole('button',{name:'＋ 月目标',exact:true}).click();const month=page.locator('.strategy-edit-goal[data-kind="month"]');await month.getByLabel('目标标题',{exact:true}).fill('合成月目标');await month.getByLabel('月份（如 2026-10）',{exact:true}).fill('2026-10');
  const draftSaved=page.waitForResponse(r=>r.url().endsWith('/ui/api/strategy/draft'));await page.locator('#strategy-save-draft').click();assert.equal((await draftSaved).status(),200);await page.getByText('草稿版本 1 · 正式版本 0',{exact:true}).waitFor();
  const createdAgent=await context.request.post(base+'/ui/api/clients',{headers:{origin:base,'x-csrf-token':session.csrf},data:{name:'synthetic-strategy-reader',scopes:['memory:read','sensitive:read'],expires_days:1,policy:{read_level:3,write_level:0,collections:['projects']}}});assert.equal(createdAgent.status(),201);const {token:agentToken}=await createdAgent.json();
  const agentGet=async()=>{const response=await fetch(base+'/v1/strategy?detail=full',{headers:{authorization:'Bearer '+agentToken}});assert.equal(response.status,200);return response.json();};assert.equal((await agentGet()).status,'not_published');
  const csrfRejected=await context.request.post(base+'/ui/api/strategy/publish',{headers:{origin:base},data:{authorized:true,expected_draft_version:1,expected_published_version:0}});assert.equal(csrfRejected.status(),403);
  await page.locator('#strategy-publish-confirm').check();const published=page.waitForResponse(r=>r.url().endsWith('/ui/api/strategy/publish'));await page.locator('#strategy-publish').click();assert.equal((await published).status(),200);await page.getByText('草稿版本 1 · 正式版本 1',{exact:true}).waitFor();assert.equal((await agentGet()).document.goals.length,3);
  await page.getByLabel('总战略总述',{exact:true}).fill('尚未保存的新想法');await page.locator('#strategy-publish-confirm').check();await page.locator('#strategy-publish').click();await page.locator('#notice').filter({hasText:'未保存'}).waitFor();assert.equal((await agentGet()).version,1);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.setViewportSize({width:1280,height:900});
  await page.reload();await page.locator('#workspace').waitFor({state:'visible',timeout:3000});
  assert.equal(await page.locator('#login').isVisible(),false);
  await page.goto(base+'/');await page.locator('#workspace').waitFor({state:'visible',timeout:3000});
  await page.locator('#logout').click();await startLogin();
  const rejected=await submitCode(usedCode);assert.equal(rejected.status(),401);
  await page.locator('#login-error').filter({hasText:'验证码无效'}).waitFor({state:'visible',timeout:3000});
  assert.equal(await page.locator('#workspace').isVisible(),false);
  const recovered=await submitCode(recovery[0]);assert.equal(recovered.status(),200);
  await page.locator('#workspace').waitFor({state:'visible',timeout:3000});
  assert.deepEqual(errors,[]);
 }finally{
  await browser?.close();
  if(server){server.kill('SIGTERM');await new Promise(resolve=>{server.once('exit',resolve);setTimeout(resolve,2000);});}
  await rm(dir,{recursive:true,force:true});
 }
});
