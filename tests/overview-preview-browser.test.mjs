import test from 'node:test';
import assert from 'node:assert/strict';
const base=process.env.OVERVIEW_PREVIEW_URL,mod=process.env.LOGIN_BROWSER_MODULE??process.env.PLAYWRIGHT_MODULE;
test('synthetic live Worker preview renders charts, detailed overview, evidence and mobile layout',{skip:!base||!mod,timeout:30000},async()=>{
 assert.equal(new URL(base).hostname,'127.0.0.1');
 const {chromium}=await import(mod),browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1080}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.name));
  await page.goto(base+'/preview/start');await page.locator('#primary-overview').waitFor();
  assert.equal(await page.locator('.metric-icon').count(),6);assert.equal(await page.locator('.classification-chart progress').count(),4);assert.match(await page.locator('#primary-overview').innerText(),/4 \/ 4/);
  assert.match(await page.locator('.demo-warning').innerText(),/合成资料/);assert.equal(await page.locator('#strategy-priority .strategy-goal').count(),3);assert.match(await page.locator('#strategy-priority').innerText(),/Agent 只读/);
  await page.screenshot({path:'docs/overview-demo-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'打开详细总概览',exact:true}).click();await page.locator('#overview-projects table').waitFor();
  assert.match(await page.locator('#overview-personal').innerText(),/偏好中文说明/);assert.match(await page.locator('#overview-projects').innerText(),/当前进度/);assert.match(await page.locator('#overview-next_actions').innerText(),/验收本地新版/);
  await page.screenshot({path:'docs/overview-demo-detail.png',fullPage:true});
  await page.locator('#overview-personal .evidence-links button').first().click();await page.locator('#detail').waitFor({state:'visible'});assert.match(await page.locator('#detail-body').innerText(),/主题分类/);await page.locator('#detail-close').click();
  await page.locator('[data-view="classified"]').click();const changed=page.waitForResponse(r=>r.url().includes('/ui/api/records?')&&r.url().includes('category=development'));await page.getByLabel('记忆主题分类').selectOption('development');await changed;await page.locator('#content .list-item').first().waitFor();assert.equal(await page.locator('#content .list-item').count(),2);
  await page.locator('[data-view="overview"]').click();await page.locator('#primary-overview').waitFor();
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'docs/overview-demo-mobile.png',fullPage:true});
  await page.locator('[data-view="strategy"]').click();await page.locator('.strategy-editor').waitFor();assert.equal(await page.locator('#strategy-priority .strategy-goal').count(),3);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.setViewportSize({width:1440,height:1080});await page.locator('#strategy-priority').screenshot({path:'docs/strategy-demo-published.png'});await page.screenshot({path:'docs/strategy-demo-editor.png',fullPage:false});await page.setViewportSize({width:390,height:844});await page.locator('#strategy-priority').screenshot({path:'docs/strategy-demo-mobile.png'});
  await page.locator('[data-view="overviewdetail"]').click();await page.locator('#overview-projects').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
