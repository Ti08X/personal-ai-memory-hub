import {test} from "node:test";
import assert from "node:assert/strict";
import {sourceInput,sourceEdit,assertFreeMode} from "../policy.ts";
test("free sources reject paid kinds, credentials and config injection",()=>{
  assert.equal(sourceInput.parse({name:"Example",feedUrl:"https://example.com/rss"}).intervalMinutes,120);
  for(const input of [
    {name:"X",feedUrl:"https://example.com/rss",kind:"x_search"},
    {name:"Secret",feedUrl:"https://key:password@example.com/rss"},
    {name:"Token",feedUrl:"https://example.com/rss?api_key=synthetic"},
    {name:"Jina",feedUrl:"https://r.jina.ai/https://example.com"},
    {name:"Headers",feedUrl:"https://example.com/rss",config:{headers:{Authorization:"synthetic"}}},
  ]) assert.equal(sourceInput.safeParse(input).success,false);
  assert.equal(sourceEdit.safeParse({enabled:false}).success,false);
});
test("collection-only policy fails closed when models or paid credentials are enabled",()=>{
  const old=process.env.MODEL_CALLS_ENABLED;
  try{
    process.env.MODEL_CALLS_ENABLED="false";assertFreeMode();
    process.env.MODEL_CALLS_ENABLED="true";assert.throws(assertFreeMode);
    process.env.MODEL_CALLS_ENABLED="false";process.env.SOCIALDATA_API_KEY="synthetic";assert.throws(assertFreeMode);
  }finally{delete process.env.SOCIALDATA_API_KEY;if(old===undefined)delete process.env.MODEL_CALLS_ENABLED;else process.env.MODEL_CALLS_ENABLED=old;}
});
