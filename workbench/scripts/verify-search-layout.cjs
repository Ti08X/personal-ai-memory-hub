const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const views=['overview','memory','ideas','intel','projects','infra','tools','settings'];
const shellGeometry=()=>{
 const rect=selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
 return {sidebar:rect('.sidebar'),nav:rect('.nav-item'),footer:rect('.sidebar-foot'),main:rect('.main'),rootScroll:document.documentElement.scrollTop,bodyHeight:document.body.getBoundingClientRect().height,viewportHeight:innerHeight};
};

(async()=>{
 const {preview}=await import('./preview.mjs');
 const server=preview({demo:false,refreshMs:3600000});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const page=await browser.newPage();
 const errors=[]; page.on('pageerror',error=>errors.push(error.message));
 const time='2026-10-25T09:12:00Z';
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url()),p=url.pathname;let data;
  if(process.env.SEARCH_LAYOUT_ASSETS&&['/assets/reference-ui.js','/assets/reference-ui.css','/assets/reference-readable.css'].includes(p)){
   await route.fulfill({body:fs.readFileSync(path.join(process.env.SEARCH_LAYOUT_ASSETS,p)),contentType:p.endsWith('.js')?'text/javascript':'text/css'});return;
  }
  if(p==='/api/wb/system')data={hostname:'synthetic-host',cpuCount:2,cpuPercent:10,memory:{total:4294967296,percent:25},disk:{total:107374182400,percent:10},network:{},history:[]};
  else if(p==='/api/wb/containers')data={ok:true,total:0,running:0,containers:[]};
  else if(p==='/api/wb/intel/snapshot')data={ok:true,modelsEnabled:false,paidProvidersEnabled:false,totals:{articles:0,today:0,sources:0,enabled:0,healthy:0,paidReceipts:0},sources:[],runs:[],articles:[]};
  else if(p.startsWith('/api/wb/'))data={items:[],creds:[],available:false};
  else if(p.endsWith('/stats'))data={total_nodes:8506,total_links:200,total_documents:100,nodes_by_fact_type:{world:2981,experience:1898,observation:3627}};
  else if(p.endsWith('/memories/list')){
   const query=url.searchParams.get('q');
   const count=query?0:50;
   data={items:Array.from({length:count},(_,i)=>({id:'synthetic-'+i,text:'合成记忆 '+i+'。这是一段用于验证页面布局和搜索滚动的长内容。'.repeat(8),fact_type:'world',mentioned_at:time,tags:['合成']})),total:query?0:8506};
  }else if(p.endsWith('/tags'))data={items:[]};
  else if(p.endsWith('/operations'))data={operations:[]};
  else if(p.endsWith('/documents'))data={items:[]};
  else if(p.endsWith('/graph'))data={nodes:[],edges:[]};
  else if(p.includes('/stats/memories-timeseries'))data={buckets:[]};
  if(data)await route.fulfill({json:data});else await route.continue();
 });
 try{
  const origin='http://127.0.0.1:'+server.address().port;
  const results=[];
  for(const size of [{width:1654,height:951},{width:1462,height:727},{width:1366,height:900},{width:1024,height:768},{width:390,height:844}]){
   await page.setViewportSize(size);
   await page.goto(origin+'/#memory'); await page.reload();
   await page.locator('.timeline-row').first().waitFor();
   let expected;
   for(const view of views){
    await page.locator('button[data-view="'+view+'"]').click();
    const before=await page.evaluate(shellGeometry);
    expected??=before;
    assert.equal(before.sidebar.width,expected.sidebar.width,'navigation width changed on '+view);
    assert.equal(before.nav.height,expected.nav.height,'navigation item height changed on '+view);
    assert.equal(before.footer.y,expected.footer.y,'navigation footer moved on '+view);
    assert.equal(before.main.y,0,'main page moved out of the viewport');
    assert.equal(before.rootScroll,0);
    assert.equal(await page.locator('#palette').isVisible(),false);
    await page.locator('#globalSearch').click();
    await page.locator('#paletteInput').waitFor({state:'visible'});
    const overlay=await page.evaluate(()=>{
     const p=document.querySelector('#palette'),box=p.querySelector('.palette-box'),r=box.getBoundingClientRect();
     return {position:getComputedStyle(p).position,top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:innerHeight,width:innerWidth,rootScroll:document.documentElement.scrollTop,mainY:document.querySelector('.main').getBoundingClientRect().y};
    });
    assert.equal(overlay.position,'fixed');assert.equal(overlay.rootScroll,0);assert.equal(overlay.mainY,0);
    assert.ok(overlay.top>=0&&overlay.bottom<=overlay.height+1&&overlay.left>=0&&overlay.right<=overlay.width+1,'search overlay outside viewport');
    await page.locator('#paletteInput').fill('does-not-exist');
    await page.locator('#paletteList .empty-state').waitFor();
    await page.locator('#paletteInput').press('Escape');
    assert.equal(await page.locator('#palette').isVisible(),false);
    assert.deepEqual(await page.evaluate(shellGeometry),before,'search changed shell layout');
    results.push({view,...size,sidebarWidth:before.sidebar.width,navHeight:before.nav.height,overlayContained:true,rootScroll:0});
   }
   await page.locator('#globalSearch').click();
   await page.locator('#paletteInput').fill('记忆');
   await page.locator('[data-palette-type="page"][data-palette-id="memory"]').click();
   assert.equal(await page.locator('#palette').isVisible(),false);
   assert.equal(await page.locator('#workspacePage').getAttribute('data-view'),'memory');
   await page.locator('#memorySearch').fill('empty-result-fixture');
   await page.getByText('已加载 0 / 0 条 · 搜索由后端执行',{exact:true}).waitFor();
   assert.equal((await page.evaluate(shellGeometry)).rootScroll,0);
   await page.locator('#memorySearch').fill(''); await page.locator('.timeline-row').first().waitFor();
   if(size.width>760){
    await page.locator('.brand-collapse').click();
    for(const view of ['overview','memory','projects']){
     await page.locator('button[data-view="'+view+'"]').click();
     assert.equal((await page.evaluate(shellGeometry)).sidebar.width,65,'collapsed rail changed across pages');
    }
    await page.reload();
   }
  }
  await page.setViewportSize({width:1462,height:727});
  await page.locator('button[data-view="memory"]').click();
  if(process.env.SEARCH_LAYOUT_OUTPUT){fs.mkdirSync(process.env.SEARCH_LAYOUT_OUTPUT,{recursive:true});await page.screenshot({path:path.join(process.env.SEARCH_LAYOUT_OUTPUT,'memory-fixed.png')})}
  await page.locator('#globalSearch').click();
  if(process.env.SEARCH_LAYOUT_OUTPUT)await page.screenshot({path:path.join(process.env.SEARCH_LAYOUT_OUTPUT,'search-fixed.png')});
  await page.locator('#paletteInput').press('Escape');
  await page.locator('#dataMode').click();
  for(const view of views){
   await page.locator('button[data-view="'+view+'"]').click();
   await page.locator('#globalSearch').click();
   assert.equal(await page.locator('#palette').evaluate(e=>getComputedStyle(e).position),'fixed');
   assert.equal(await page.evaluate(()=>scrollY),0);
   await page.locator('#paletteInput').press('Escape');
  }
  assert.deepEqual(errors,[]);
  const result={syntheticDataOnly:true,pageViewportChecks:results.length,demoSearchChecks:views.length,results,scriptErrors:errors};
  if(process.env.SEARCH_LAYOUT_OUTPUT)fs.writeFileSync(path.join(process.env.SEARCH_LAYOUT_OUTPUT,'regression-results.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
})().catch(error=>{console.error(error);process.exitCode=1});
