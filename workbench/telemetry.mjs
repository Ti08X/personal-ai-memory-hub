import os from 'node:os';
import {X509Certificate} from 'node:crypto';
import {readFileSync,statfsSync,statSync,existsSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const cpu=()=>os.cpus().reduce((a,c)=>{a.idle+=c.times.idle;a.total+=Object.values(c.times).reduce((n,v)=>n+v,0);return a},{idle:0,total:0});
function network(){try{const iface=readFileSync('/proc/net/route','utf8').split('\n').slice(1).map(l=>l.trim().split(/\s+/)).find(x=>x[1]==='00000000')?.[0];const line=readFileSync('/proc/net/dev','utf8').split('\n').find(l=>l.split(':')[0].trim()===iface);const v=line?.split(':')[1].trim().split(/\s+/).map(Number);return v?{interface:iface,rx:v[0],tx:v[8]}:null}catch{return null}}
export function telemetry(db,{origin,certPath}={}){
 db.exec('CREATE TABLE IF NOT EXISTS wb_samples(time TEXT PRIMARY KEY,cpu REAL,memory REAL,disk REAL,rx REAL,tx REAL);CREATE TABLE IF NOT EXISTS wb_activity(id INTEGER PRIMARY KEY,time TEXT NOT NULL,method TEXT NOT NULL,resource TEXT NOT NULL,status INTEGER NOT NULL)');
 let previous=cpu(),prevNet=network(),prevTime=Date.now(),cached=null,lastSample=0;
 const sample=()=>{
  const now=Date.now(),c=cpu(),net=network(),elapsed=(now-prevTime)/1000;let usage=elapsed>=1&&c.total>previous.total?100*(1-(c.idle-previous.idle)/(c.total-previous.total)):null;
  let available=os.freemem();try{const m=/MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo','utf8'));if(m)available=+m[1]*1024}catch{}
  let disk=null;try{const f=statfsSync(process.env.WB_DISK_PATH||'/');disk={total:f.blocks*f.bsize,used:(f.blocks-f.bavail)*f.bsize,percent:100*(1-f.bavail/f.blocks)}}catch{}
  const traffic=net&&prevNet&&net.interface===prevNet.interface&&elapsed>=1?{interface:net.interface,rxPerSecond:Math.max(0,(net.rx-prevNet.rx)/elapsed),txPerSecond:Math.max(0,(net.tx-prevNet.tx)/elapsed)}:null;
  const time=new Date(now).toISOString();cached={collectedAt:time,hostname:os.hostname(),platform:os.platform(),cpuCount:os.cpus().length,cpuPercent:usage,memory:{total:os.totalmem(),used:os.totalmem()-available,percent:100*(1-available/os.totalmem())},disk,network:traffic,uptimeSeconds:os.uptime(),loadAverage:os.loadavg()};
  if(now-lastSample>=10000){db.prepare('INSERT OR REPLACE INTO wb_samples VALUES(?,?,?,?,?,?)').run(time,usage,cached.memory.percent,disk?.percent??null,traffic?.rxPerSecond??null,traffic?.txPerSecond??null);db.prepare('DELETE FROM wb_samples WHERE time < ?').run(new Date(now-86400000).toISOString());lastSample=now}
  previous=c;prevNet=net;prevTime=now;return cached;
 };
 const timer=setInterval(sample,15000);timer.unref();sample();
 return {
  system(){const current=cached||sample();return {...current,history:db.prepare('SELECT * FROM wb_samples ORDER BY time DESC LIMIT 120').all().reverse()}},
  async containers(){try{const {stdout}=await run('docker',['ps','-a','--format','{{json .}}'],{timeout:8000,maxBuffer:512*1024});const list=stdout.trim().split('\n').filter(Boolean).map(l=>{const c=JSON.parse(l);return {name:c.Names,status:c.State,image:c.Image,uptime:c.Status}});let stats=[];try{const r=await run('docker',['stats','--no-stream','--format','{{json .}}'],{timeout:12000,maxBuffer:512*1024});stats=r.stdout.trim().split('\n').filter(Boolean).map(x=>JSON.parse(x))}catch{}
   return {ok:true,collectedAt:new Date().toISOString(),total:list.length,running:list.filter(c=>c.status==='running').length,containers:list.map(c=>{const s=stats.find(s=>s.Name===c.name);return {...c,cpuPercent:s?Number(s.CPUPerc.replace('%','')):null,memory:s?.MemUsage??null,memoryPercent:s?Number(s.MemPerc.replace('%','')):null}})}
  }catch{return {ok:false,collectedAt:new Date().toISOString(),containers:[],error:'container_metrics_unavailable'}}},
  record(method,path,status){if(!['POST','PATCH','DELETE'].includes(method))return;const resource=path.startsWith('/api/creds')?'credentials':path.startsWith('/api/items')?'items':null;if(!resource)return;db.prepare('INSERT INTO wb_activity(time,method,resource,status) VALUES(?,?,?,?)').run(new Date().toISOString(),method,resource,status);db.exec('DELETE FROM wb_activity WHERE id NOT IN (SELECT id FROM wb_activity ORDER BY id DESC LIMIT 1000)')},
  tls(){if(!certPath)return {available:false,reason:'certificate_path_not_configured'};try{const cert=new X509Certificate(readFileSync(certPath));return {available:true,domain:new URL(origin).hostname,validFrom:cert.validFrom,validTo:cert.validTo,daysRemaining:Math.floor((Date.parse(cert.validTo)-Date.now())/86400000),coverage:'configured_origin_certificate_only'}}catch{return {available:false,reason:'certificate_read_unavailable'}}},
  activity(){return {items:db.prepare('SELECT time,method,resource,status FROM wb_activity ORDER BY id DESC LIMIT 100').all(),coverage:'workbench_mutations_since_instrumentation'}},
  security(keyPath){let permission=null;try{permission=(statSync(keyPath).mode&0o777).toString(8)}catch{}return {credentialCipher:'AES-256-GCM',keyFilePresent:existsSync(keyPath),keyFileMode:permission,apiBinding:'127.0.0.1',authentication:'upstream_reverse_proxy',score:null,members:null,devices:null,coverage:'workbench_configuration_only'}},
  close(){clearInterval(timer)}
 };
}
