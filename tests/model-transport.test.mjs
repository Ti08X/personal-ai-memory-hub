import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';

// Run actual workerd fetch, not Node fetch or an injected Models transport.
// Every outbound request goes to synthetic fixtures; no real key or vendor call.
const {outputFiles} = await build({
  stdin: {contents: `
    import {Models, modelList} from './src/models.ts';
    const models = new Models({SILICONFLOW_API_KEY:'synthetic-key', SUMMARY_API_KEY:'synthetic-key', SUMMARY_BASE_URL:'https://gateway.test/v1', SUMMARY_MODEL:'synthetic-model'});
    export default {async fetch(request) {
      try {
        const path = new URL(request.url).pathname;
        let result;
        if (path === '/models') result = await modelList('https://gateway.test/v1','synthetic-key');
        else if (path === '/embed') result = await models.embed(['合成资料']);
        else if (path === '/rerank') result = await models.rerank('合成查询',['合成资料']);
        else result = await models.summarize([{id:'e1',version:1,timestamp:'2026-10-13T00:00:00Z',text:'合成资料'}]);
        return Response.json({result});
      } catch (error) { return Response.json({error:error.code,status:error.status},{status:500}); }
    }};
  `,resolveDir:new URL('..',import.meta.url).pathname, sourcefile:'model-runtime.ts'},
  bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'
});

function runtime(handler) {
  return new Miniflare(convertV4MiniflareOptions({
    modules:true, script:outputFiles[0].text,
    compatibilityDate:'2026-10-10', outboundService:handler
  }));
}

test('real Workers runtime supports all four model request paths with manual redirects', async () => {
  const calls=[];
  const mf=runtime(async request => {
    const url=new URL(request.url);calls.push(url.pathname);
    assert.equal(request.headers.get('authorization'),'Bearer synthetic-key');
    if(url.pathname==='/v1/models')return Response.json({data:[{id:'synthetic-model'}]});
    assert.equal(request.method,'POST');
    const body=await request.json();
    if(url.pathname==='/v1/embeddings'){
      assert.equal(body.model,'BAAI/bge-m3');
      return Response.json({data:[{index:0,embedding:Array.from({length:1024},(_,i)=>i===0?1:0)}]});
    }
    if(url.pathname==='/v1/rerank'){
      assert.equal(body.model,'BAAI/bge-reranker-v2-m3');
      return Response.json({results:[{index:0,relevance_score:0.9}]});
    }
    assert.equal(url.pathname,'/v1/chat/completions');
    return Response.json({choices:[{message:{content:JSON.stringify({overview:[{text:'合成概要',evidence_ids:['e1']}],plans:[]})}}]});
  });
  try {
    const results=[];
    for(const path of ['models','embed','rerank','summary']){
      const response=await mf.dispatchFetch('https://memory.test/'+path);
      const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));results.push(data.result);
    }
    assert.deepEqual(results[0],['synthetic-model']);
    assert.equal(results[1][0].length,1024);
    assert.equal(results[2][0].score,0.9);
    assert.equal(results[3].content.overview[0].text,'合成概要');
    assert.deepEqual(calls,['/v1/models','/v1/embeddings','/v1/rerank','/v1/chat/completions']);
  } finally {await mf.dispose();}
});

test('real Workers runtime rejects vendor redirects without forwarding credentials',async()=>{
  const calls=[];
  const mf=runtime(request=>{
    const url=new URL(request.url);calls.push(url.hostname);
    return new Response(null,{status:302,headers:{location:'https://different.test/steal'}});
  });
  try {
    for(const path of ['models','embed','rerank','summary']){
      const response=await mf.dispatchFetch('https://memory.test/'+path);
      const data=await response.json();assert.equal(response.status,500);
      assert.equal(data.status,503);assert.equal(data.error,path==='models'?'model_list_unavailable':'model_service_unavailable');
    }
    assert.deepEqual(calls,['gateway.test','api.siliconflow.cn','api.siliconflow.cn','gateway.test']);
  } finally {await mf.dispose();}
});

test('real Workers runtime identifies provider 429 without exposing provider responses',async()=>{
 const mf=runtime(()=>new Response('synthetic-private-provider-error',{status:429}));
 try{
  for(const path of ['embed','rerank','summary']){
   const response=await mf.dispatchFetch('https://memory.test/'+path),data=await response.json();
   assert.equal(data.error,'model_provider_rate_limit');assert.equal(data.status,429);
   assert.ok(!JSON.stringify(data).includes('synthetic-private-provider-error'));
  }
 }finally{await mf.dispose();}
});
