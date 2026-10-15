import {summaryPanel,projectTable,categoryLabels} from '/overview-ui.js';
const names={conversation:'会话概要',category:'类别概要',project:'项目概要',day:'日概要',week:'周概要',month:'月概要'};
const states={pending:'等待整理',processing:'整理中',ready:'已就绪',failed:'失败，等待重试'};
export async function renderLibrary(h){
 const data=await h.api('/library/insights'),state=data.processing,root=h.el('div','library-workspace');
 const intro=h.card('记忆工作台','原文 → 多分类与标签 → 项目 / 时间索引 → 有出处的概要');
 intro.append(h.el('p','muted','以下统计仅覆盖当前权限下已经提交的资料。接入 MCP 不会自动获得其他平台的私有聊天历史。'));
 const tabs=h.el('div','library-tabs');const sections=[['coverage','数据覆盖'],['imports','导入任务'],['processing','整理进度'],['taxonomy','分类与标签'],['timeline','时间回溯'],['projects','项目进度'],['handoff','AI 接手预览'],['quality','质量检查']];
 for(const [id,title] of sections)tabs.append(h.button(title,()=>root.querySelector('#library-'+id)?.scrollIntoView({behavior:'smooth',block:'start'}),'quiet'));
 intro.append(tabs);root.append(intro);
 function panel(id,title,note){const c=h.card(title,note);c.id='library-'+id;c.classList.add('library-section');root.append(c);return c;}
 function table(parent,head,rows){const wrap=h.el('div','overview-table-wrap'),t=h.el('table'),tr=h.el('tr');for(const value of head)tr.append(h.el('th','',value));t.append(tr);for(const row of rows){const tr=h.el('tr');for(const value of row)tr.append(h.el('td','',String(value??'—')));t.append(tr);}wrap.append(t);parent.append(wrap);if(!rows.length)parent.append(h.el('p','muted','此范围暂无可见记录。'));}
 const coverage=panel('coverage','01 · 数据覆盖','统计上传的消息记录；长消息可能分段，不等于原始消息总数。');
 table(coverage,['平台','会话','消息记录','最早','最近'],data.coverage.map(p=>[p.source_platform,p.conversations,p.message_records,h.date(p.first_at),h.date(p.last_at)]));
 coverage.append(h.el('p','muted','官方平台的未导出聊天、附件二进制和不可读来源不在统计中；没有观察到某个平台，不代表没有使用。'));
 const imports=panel('imports','02 · 导入任务','显示本版上线后最近 30 次导入回执；早期任务没有回执不代表没有导入。');
 table(imports,['接收时间','新增 / 修订','重复','冲突','批次'],data.imports.map(i=>[h.date(i.received_at),i.saved,i.duplicates,i.conflicts,i.batch_id]));
 const processing=panel('processing','03 · 整理进度',state.enabled?'自动整理已开启 · '+(state.runtime==='Cloudflare Workflows'?'云端后台处理':'本地示例 / 手动推进'):'自动整理已暂停');
 const metrics=h.el('div','stats');for(const [title,note] of [['已提交原文',state.counts.total],['已提取分类与标签',state.counts.organized],['待提取',state.counts.total-state.counts.organized]]){const c=h.el('div','stat');c.append(h.el('span','stat-label',title),h.el('strong','stat-value',String(note)));metrics.append(c);}processing.append(metrics);
 table(processing,['概要状态','数量'],state.stages.map(s=>[states[s.status]??s.status,s.count]));
 processing.append(h.el('p','muted','模型调用不设每日次数额度。任务分批运行，保存游标；模型临时失败会保留进度并在稍后重试。已提取不等于全部概要已经生成。'));
 if(h.can('admin')){
  const actions=h.el('div','dialog-actions');actions.append(h.button(state.enabled?'暂停自动整理':'开启增量整理',async()=>{await h.api('/library/control',{method:'POST',body:{authorized:true,enabled:!state.enabled,expected_revision:state.control_revision}});await h.reload();},'primary'));
  if(state.enabled)actions.append(h.button('处理下一批',async()=>{const result=await h.api('/library/process',{method:'POST',body:{authorized:true}});await h.reload();h.notice('本批提取 '+(result.extraction.extracted??0)+' 条；概要状态：'+(states[result.summaries.status]??result.summaries.status)+'。');}));
  actions.append(h.button('重试失败任务',async()=>{await h.api('/library/retry',{method:'POST',body:{authorized:true}});await h.reload();h.notice('失败任务已重新排队；原文没有改变。');}));processing.append(actions);
 }
 async function openSummary(item){
  const value=await h.api('/library/summaries/'+item.id),body=h.modal(names[item.kind]+' · '+item.title);
  body.append(h.el('p','muted',(states[value.status]??value.status)+' · 修订 '+value.version+' · '+h.date(value.updated_at)));
  if(!value.overview){body.append(h.el('p','muted','概要尚未就绪，或原文刚刚变化；旧概要暂停展示。'));return;}
  body.append(summaryPanel({...value,summary_title:names[item.kind]+' · '+item.title,counts:{classified:value.covered,total_sources:item.total},coverage:{included_sources:value.covered,available_sources:item.total}},{...h,evidenceIndex:value.evidence_index},true));
 }
 async function summaryList(parent,kind){
  let cursor=0;const list=h.el('div','list'),more=h.button('加载更多',()=>load(),'load-more');parent.append(list,more);
  async function load(){const page=await h.api('/library/summaries?'+new URLSearchParams({kind,limit:'12',cursor:String(cursor)}));for(const item of page.summaries){const b=h.button('',()=>openSummary(item),'list-item');b.append(h.el('strong','',item.title),h.el('p','muted',(states[item.status]??item.status)+' · 已整理 '+item.covered+' / '+item.total+' 条 · 修订 '+item.revision));if(item.error_code)b.append(h.el('small','error',item.error_code));list.append(b);}if(cursor===0&&!page.summaries.length)list.append(h.el('p','muted','尚无当前权限下可见的'+names[kind]+'。'));cursor=page.next_cursor;more.hidden=cursor===null;}await load();
 }
 const taxonomy=panel('taxonomy','04 · 分类与标签','分类可重叠：个人、开发、工作、健康、学习。一条记录可以有多个标签与项目归属。');
 const cloud=h.el('div','library-tabs');for(const tag of data.tags)cloud.append(h.button(tag.name+' · '+tag.count,async()=>{
  const body=h.modal('标签：'+tag.name),list=h.el('div','list');let cursor=0;const more=h.button('加载更多',()=>load(),'load-more');body.append(list,more);async function load(){const page=await h.api('/library/records?'+new URLSearchParams({kind:'tag',name:tag.name,cursor:String(cursor)}));for(const r of page.records)list.append(h.recordItem(r));cursor=page.next_cursor;more.hidden=cursor===null;}await load();
 },'secondary'));taxonomy.append(cloud,h.el('p','muted','标签数量来自最近 '+data.tag_sample.records+' 条已整理资料的样本；'+(data.tag_sample.complete?'当前样本覆盖已整理记录。':'并非全库标签总量。')+' 打开原文详情可纠正分类、标签和项目。'));await summaryList(taxonomy,'category');
 const timeline=panel('timeline','05 · 时间回溯','Asia/Shanghai · 周一作为周起始日。概要只包含已上传且允许读取的来源。');
 const select=h.el('select');select.setAttribute('aria-label','概要时间粒度');for(const kind of ['day','week','month','conversation'])select.append(new Option(names[kind],kind));select.value='month';const timeList=h.el('div');select.onchange=()=>{timeList.replaceChildren();summaryList(timeList,select.value).catch(e=>h.notice(e.message,true));};timeline.append(select,timeList);await summaryList(timeList,'month');
 const projects=panel('projects','06 · 项目进度','每个项目分别整理当前进度、阻塞与下一步；讨论过的建议不会自动成为正式战略。');await summaryList(projects,'project');
 const handoff=panel('handoff','07 · AI 接手预览','显示当前登录权限对应的资料；受限 Key 必须用它自己的权限读取。');
 const value=await h.api('/handoff');
 // The same public context endpoint is used by AI clients; no alternate owner-only summary.
 handoff.append(h.el('p','muted','AI 先读本人发布的战略，再读个人 / 项目 / 近期概要索引，最后按需回查原文。'));
 const strategy=value.strategy;handoff.append(h.el('h3','','第一层：本人正式战略'),h.el('p','',strategy?.document?.vision??'尚未发布，或当前权限不可见。'));for(const goal of strategy?.document?.goals??[])handoff.append(h.el('p','',({strategy:'总战略',stage:'阶段战略',month:'月目标'}[goal.kind]??goal.kind)+'：'+goal.title));
 handoff.append(h.el('h3','','第二层：个人与项目概要索引'));for(const item of value.library?.summaries??[]){const row=h.el('div','overview-claim');row.append(h.el('strong','',item.title),h.el('p','',item.brief??states[item.status]??item.status),h.button('查看依据与详情',()=>openSummary(item),'quiet'));handoff.append(row);}if(value.overview)handoff.append(summaryPanel(value.overview,h));
 const preview=h.el('details');preview.append(h.el('summary','','查看当前权限下的接手响应'),h.el('pre','record-text',JSON.stringify(value,null,2)));handoff.append(preview);
 const quality=panel('quality','08 · 质量检查','失败、冲突、未处理内容分别保留；不会自动覆盖冲突事实。');
 table(quality,['检查项','当前数量'],[['待确认冲突',data.quality?.unresolved_conflicts??0],['待提取原文',state.counts.total-state.counts.organized],['本页来源失败（最多 20 条）',state.failures.length]]);
 for(const failure of state.failures)quality.append(h.button(failure.error_code+' · '+failure.record_id,()=>h.openSource(failure.record_id),'quiet'));
 quality.append(h.el('p','muted','来源修订或删除会让关联概要失效，重建后才恢复展示。低权限 Key 不能透过概要、标签或统计访问高敏感原文。分类为 AI 提取的主题，事实与完成状态仍以原文证据为准。'));
 return root;
}
export async function editTaxonomy(r,h){
 const current=await h.api('/library/labels/'+r.id),body=h.modal('分类、标签与项目'),form=h.el('form'),checks=[];
 for(const [key,label] of Object.entries(categoryLabels).filter(([k])=>k!=='unclassified')){const n=h.el('input');n.type='checkbox';n.checked=current.categories.includes(key);n.onchange=()=>{if(n.checked)for(const [other,input] of checks)if(other==='other'||key==='other')input.checked=input===n;};const l=h.el('label','check');l.append(n,document.createTextNode(label));form.append(l);checks.push([key,n]);}
 function field(title,values){const label=h.el('label','',title),input=h.el('input');input.value=values.join('，');label.append(input);form.append(label);return input;}
 const tags=field('标签（逗号分隔）',current.labels.tags),projects=field('项目名称（逗号分隔）',current.labels.projects),save=h.el('button','primary','保存分类与标签');save.type='submit';
 const error=h.el('p','error');error.setAttribute('role','alert');form.append(h.el('p','muted','仅修改主题索引，不改原文或正式战略；已生成的关联概要会重新整理。'),error,save);
 form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{const split=n=>n.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean);await h.api('/library/labels',{method:'POST',body:{authorized:true,id:r.id,version:current.version,expected_revision:current.revision,expected_classification_revision:current.classification_revision,categories:checks.filter(([,n])=>n.checked).map(([k])=>k),tags:split(tags),projects:split(projects)}});await h.openSource(r.id);h.notice('分类、标签与项目已保存。');}catch(e){error.textContent=e.message;}finally{save.disabled=false;}};body.append(form);
}
