import {readFile,realpath} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {database} from './database.mjs';
import {Vectors} from './vectors.mjs';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.md':'text/markdown; charset=utf-8','.py':'text/plain; charset=utf-8','.sha256':'text/plain; charset=utf-8','.tgz':'application/gzip','.zip':'application/zip'};
export async function environment(root=resolve(new URL('..',import.meta.url).pathname)){
 if(Buffer.from(process.env.ENCRYPTION_KEY??'','base64').length!==32)throw new Error('Server encryption key is required');
 const DB=database(process.env.DATABASE_PATH??'/var/lib/personal-memory-hub/memory.sqlite',resolve(root,'migrations'));
 const assets=await realpath(resolve(root,'public'));
 const ASSETS={async fetch(req){
  let file;try{file=await realpath(resolve(assets,'.'+new URL(req.url).pathname));}catch{return new Response('Not found',{status:404});}
  if(!file.startsWith(assets+sep))return new Response('Not found',{status:404});
  const ext=file.slice(file.lastIndexOf('.'));return new Response(await readFile(file),{headers:{'content-type':types[ext]??'application/octet-stream'}});
 }};
 const VECTOR_INDEX=process.env.QDRANT_URL?new Vectors(process.env.QDRANT_URL,process.env.QDRANT_COLLECTION,process.env.QDRANT_API_KEY):undefined;
 const env={DB,ASSETS,VECTOR_INDEX,ENCRYPTION_KEY:process.env.ENCRYPTION_KEY,RAG_ENABLED:VECTOR_INDEX?'true':'false',ALLOWED_ORIGINS:process.env.ALLOWED_ORIGINS,SUMMARY_BASE_URL:process.env.SUMMARY_BASE_URL??'https://api.zgatri.com/v1',SUMMARY_MODEL:process.env.SUMMARY_MODEL??'',SUMMARY_API_KEY:process.env.SUMMARY_API_KEY,SILICONFLOW_API_KEY:process.env.SILICONFLOW_API_KEY};
 return env;
}
