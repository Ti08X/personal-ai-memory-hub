const presets=[['all','全部时间'],['today','今天'],['yesterday','昨天'],['seven','近 7 天'],['month','本月'],['previous-month','上月'],['custom','自定义']];
const dayAt=now=>new Date(new Date(now).getTime()+8*3600000).toISOString().slice(0,10);
const shift=(day,offset)=>new Date(Date.parse(day+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
export function archiveRange(preset,now=new Date()){
 const today=dayAt(now);
 if(preset==='today')return {from:today,to:today};
 if(preset==='yesterday'){const day=shift(today,-1);return {from:day,to:day};}
 if(preset==='seven')return {from:shift(today,-6),to:today};
 if(preset==='month')return {from:today.slice(0,7)+'-01',to:today};
 if(preset==='previous-month'){const last=shift(today.slice(0,7)+'-01',-1);return {from:last.slice(0,7)+'-01',to:last};}
 return {from:'',to:''};
}
export function archiveQuery({source='',from='',to='',cursor=0}){
 const valid=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
 if((from&&!valid(from))||(to&&!valid(to)))throw new Error('请选择有效日期。');
 if(from&&to&&from>to)throw new Error('开始日期不能晚于结束日期。');
 const q=new URLSearchParams({limit:'30',cursor:String(cursor),include_summary:'true'});
 if(source)q.set('source_platform',source);
 if(from)q.set('since',from+'T00:00:00+08:00');
 if(to)q.set('until',to+'T23:59:59.999+08:00');
 return q;
}
export function conversationSummary(c,h){
 const s=c.summary,box=h.el('div','conversation-summary'),head=h.el('div','conversation-summary-head');
 head.append(h.el('strong','','会话概要'));
 const state=s?.status??'pending',names={ready:'已生成',partial:'部分概要',pending:'等待整理',processing:'整理中',failed:'等待重试'};
 head.append(h.el('span','summary-state '+state,names[state]??'等待整理'));box.append(head);
 if(s?.brief)box.append(h.el('p','conversation-brief',s.brief));
 else box.append(h.el('p','summary-placeholder',state==='failed'?'概要生成暂未成功，后台会继续重试。':state==='processing'?'正在整理这段对话，完成后会在这里显示概要。':'这段对话还没有可展示的概要，已纳入后台整理范围。'));
 const total=s?.total??c.conversation_message_records??c.message_records;
 if(state!=='ready')box.append(h.el('small','muted','当前概要覆盖 '+(s?.covered??0)+' / '+total+' 条消息记录；保留原文供你随时查看。'));
 return box;
}
export async function renderArchive(h){
 const d=await h.api('/dashboard'),root=h.el('div','archive-workspace'),filters=h.el('section','card archive-filters'),heading=h.el('div','archive-filter-heading');
 heading.append(h.el('h2','','按时间回看聊天'),h.el('span','muted','按消息发生时间 · 北京时间'));filters.append(heading);
 const shortcuts=h.el('div','archive-presets');shortcuts.setAttribute('aria-label','快捷时间范围');
 const source=h.el('select');source.setAttribute('aria-label','筛选来源平台');source.append(new Option('全部平台',''));for(const p of d.platforms)source.append(new Option(h.platform(p.source_platform)+' · '+p.conversations+' 个会话',p.source_platform));
 const platformLabel=h.el('label','','来源平台');platformLabel.append(source);
 const from=h.el('input'),to=h.el('input');from.type=to.type='date';from.setAttribute('aria-label','开始日期');to.setAttribute('aria-label','结束日期');
 const custom=h.el('form','archive-custom'),start=h.el('label','','开始日期'),end=h.el('label','','结束日期');start.append(from);end.append(to);custom.append(start,h.el('span','range-divider','至'),end);custom.hidden=true;
 const apply=h.el('button','primary','应用日期');apply.type='submit';custom.append(apply);
 const controls=h.el('div','archive-filter-controls'),rangeLabel=h.el('p','archive-range-label'),error=h.el('p','error archive-filter-error');error.setAttribute('role','alert');error.hidden=true;
 controls.append(platformLabel,custom);filters.append(shortcuts,controls,rangeLabel,error);
 const results=h.el('div','archive-results'),count=h.el('p','muted');count.setAttribute('aria-live','polite');
 const clear=h.button('清除筛选',async()=>{source.value='';setPreset('all');await load(true);},'quiet');results.append(count,clear);
 const list=h.el('div','list archive-list'),more=h.button('加载更多会话',()=>load(false),'load-more');root.append(filters,results,list,more);
 let preset='all',cursor=0,request=0,shown=0,messages=0;const choices=[];
 function setPreset(value){preset=value;custom.hidden=value!=='custom';if(value!=='custom'){const range=archiveRange(value);from.value=range.from;to.value=range.to;}for(const [key,b] of choices){b.classList.toggle('active',key===value);b.setAttribute('aria-pressed',String(key===value));}}
 for(const [key,title] of presets){const b=h.button(title,async()=>{setPreset(key);if(key!=='custom')await load(true);},'archive-preset');choices.push([key,b]);shortcuts.append(b);}
 async function load(reset){
  let q;try{q=archiveQuery({source:source.value,from:from.value,to:to.value,cursor:reset?0:cursor});error.hidden=true;}catch(e){error.textContent=e.message;error.hidden=false;return;}
  const current=++request,range={since:q.get('since'),until:q.get('until')};more.disabled=true;root.setAttribute('aria-busy','true');
  try{const page=await h.api('/conversations?'+q);if(current!==request||!root.isConnected)return;
   if(reset){list.replaceChildren();shown=0;messages=0;}
   for(const c of page.conversations){const item=h.button('',()=>h.showConversation(c,range),'list-item conversation-card'),head=h.el('div','item-head');
    head.append(h.el('strong','conversation-title',c.title||h.platform(c.source_platform)+' 对话'),h.el('span','badge',c.message_records+' 条'+(range.since||range.until?'匹配消息':'消息记录')));
    const meta=h.el('div','item-meta');meta.append(h.el('span','source-tag',h.platform(c.source_platform)),h.el('span','',h.date(c.first_at)+(c.first_at!==c.last_at?' — '+h.date(c.last_at):'')));
    item.append(head,meta,conversationSummary(c,h),h.el('span','archive-open','查看'+(range.since||range.until?'该时期消息':'完整对话')+' ↗'));list.append(item);shown++;messages+=c.message_records;
   }
   if(reset&&!page.conversations.length)list.append(h.el('div','empty','这个时间与平台范围内没有已上传的聊天。可以扩大时间范围或切换平台。'));
   cursor=page.next_cursor;more.hidden=cursor===null;count.textContent='已显示 '+shown+' 个会话 · '+messages+' 条'+(range.since||range.until?'匹配消息':'消息记录');
   rangeLabel.textContent=(from.value||to.value?(from.value||'最早')+' 至 '+(to.value||'最新'):'全部已上传时间')+' · '+(source.value?h.platform(source.value):'全部平台')+'。时间筛选命中会话中的消息，概要描述整个会话。';
  }finally{if(current===request){more.disabled=false;root.removeAttribute('aria-busy');}}
 }
 source.onchange=()=>load(true).catch(e=>h.notice(e.message,true));custom.onsubmit=e=>{e.preventDefault();load(true).catch(e=>h.notice(e.message,true));};setPreset('all');
 return {root,load:()=>load(true)};
}
