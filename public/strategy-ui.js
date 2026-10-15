export const goalKinds={strategy:'总战略',stage:'阶段战略',month:'月目标'};
const statuses={planned:'计划中',active:'进行中',completed:'已完成',paused:'暂停',cancelled:'取消'};
export function strategyPanel(data,h,{full=false,manage}={}){
 const panel=h.card('最高优先级 · 战略与目标',data?.published_at?'云端版本 '+data.version+' · '+h.date(data.published_at):'尚未发布');panel.id='strategy-priority';
 panel.append(h.el('p','strategy-readonly','🔒 Agent 只读 · 规划与执行任务先对齐这套云端正式目标，再参考记忆与 AI 建议。'));
 if(!data?.document)panel.append(h.el('p','overview-empty',data?.status==='scope_restricted'?'当前授权无法读取这份战略，请联系本人调整访问权限。':'还没有正式发布的战略。你可以先保存草稿，准备好后再发布给 Agent。'));
 else{
  const doc=data.document;panel.append(h.el('p','overview-brief',doc.vision));if(doc.principles)panel.append(h.el('p','strategy-principles','原则与取舍：'+doc.principles));
  const current=new Set(data.current_goal_ids??[]);const list=h.el('div','strategy-goals');
  for(const [kind,label] of Object.entries(goalKinds)){const group=h.el('section','strategy-level');group.append(h.el('h3','',label));const goals=doc.goals.filter(g=>g.kind===kind);if(!goals.length)group.append(h.el('p','muted',full?'尚未设定。':'本期无已发布的目标。'));
   for(const goal of goals){const item=h.el('article','strategy-goal');item.dataset.kind=kind;item.append(h.el('span','badge',statuses[goal.status]+(current.has(goal.id)?' · 本期':'')),h.el('h4','',goal.title));if(goal.period)item.append(h.el('small','muted',goal.period));if(goal.parent_id){const parent=doc.goals.find(g=>g.id===goal.parent_id);item.append(h.el('small','muted','承接：'+(parent?.title??goal.parent_id)));}
    if(goal.description)item.append(h.el('p','',goal.description));if(goal.success_criteria)item.append(h.el('p','strategy-criteria','达成标准：'+goal.success_criteria));
    if(goal.current_state)item.append(h.el('p','','本人确认现状：'+goal.current_state));if(goal.next_step)item.append(h.el('p','','本人确定的下一步：'+goal.next_step));
    if(goal.progress!==null){const bar=h.el('progress');bar.max=100;bar.value=goal.progress;bar.setAttribute('aria-label',goal.title+'进度');item.append(h.el('small','muted','本人维护的进度 '+goal.progress+'%'),bar);}
    if(goal.starts_on||goal.ends_on)item.append(h.el('small','muted',(goal.starts_on??'未定')+' → '+(goal.ends_on??'未定')));group.append(item);
   }list.append(group);
  }panel.append(list);if(data.omitted_goals)panel.append(h.el('p','muted','精简交接省略 '+data.omitted_goals+' 项过往、未来或详细目标，可打开战略页查看全部。'));
 }
 if(manage)panel.append(h.button('查看与维护战略目标',manage,'primary'));return panel;
}
export function strategyEditor(data,h,actions){
 const wrap=h.el('div','strategy-editor'),doc=structuredClone(data.draft),panel=h.card('编辑草稿','保存草稿不会改变 Agent 读到的正式目标；点击发布后才从云端下发。');
 function field(parent,label,value,{multi=false,type='text',change,options}={}){const box=h.el('label','strategy-field',label),input=options?h.el('select'):h.el(multi?'textarea':'input');if(!options&&!multi)input.type=type;if(multi)input.rows=3;if(options)for(const [v,t] of options){const o=h.el('option','',t);o.value=v;input.append(o);}input.value=value??'';input.addEventListener('input',()=>change?.(input.value));box.append(input);parent.append(box);return input;}
 field(panel,'总战略总述',doc.vision,{multi:true,change:v=>doc.vision=v});field(panel,'原则与取舍',doc.principles,{multi:true,change:v=>doc.principles=v});field(panel,'目标读取敏感等级',doc.sensitivity,{options:[['public','L0 公开'],['normal','L1 普通'],['sensitive','L2 私密'],['restricted','L3 高敏感']],change:v=>doc.sensitivity=v});
 panel.append(h.el('p','muted','层级关系：总战略 → 阶段战略 → 月目标。进度为你确认的值；AI 的自动观察显示在个人总概览中。'));
 const list=h.el('div','strategy-edit-goals');
 const draw=()=>{list.replaceChildren();for(const goal of doc.goals){const box=h.el('section','strategy-edit-goal'),top=h.el('div','card-header');top.append(h.el('h3','',goalKinds[goal.kind]),h.button('移除目标',()=>{const removed=new Set([goal.id]);let before;do{before=removed.size;for(const g of doc.goals)if(removed.has(g.parent_id))removed.add(g.id);}while(before!==removed.size);doc.goals=doc.goals.filter(g=>!removed.has(g.id));draw();},'quiet'));box.dataset.kind=goal.kind;box.append(top);if(doc.goals.some(g=>g.parent_id===goal.id))box.append(h.el('small','muted','移除此项会同时移除其下级草稿目标；正式版在发布前保持不变。'));
  field(box,'目标标题',goal.title,{change:v=>goal.title=v});if(goal.kind!=='strategy'){const expected={stage:'strategy',month:'stage'}[goal.kind];field(box,'上级目标',goal.parent_id,{options:[['','请选择'],...doc.goals.filter(g=>g.kind===expected).map(g=>[g.id,g.title||'未命名目标'])],change:v=>goal.parent_id=v||null});}
  if(goal.kind==='month')field(box,'月份（如 2026-10）',goal.period,{change:v=>goal.period=v});
  field(box,'目标描述',goal.description,{multi:true,change:v=>goal.description=v});field(box,'可衡量的达成标准',goal.success_criteria,{multi:true,change:v=>goal.success_criteria=v});field(box,'状态',goal.status,{options:Object.entries(statuses),change:v=>goal.status=v});field(box,'本人确认现状',goal.current_state,{multi:true,change:v=>goal.current_state=v});field(box,'本人确定的下一步',goal.next_step,{multi:true,change:v=>goal.next_step=v});const progress=field(box,'进度 %（可留空）',goal.progress,{type:'number',change:v=>goal.progress=v===''?null:Number(v)});progress.min='0';progress.max='100';field(box,'开始日期（可留空）',goal.starts_on,{type:'date',change:v=>goal.starts_on=v||null});field(box,'结束日期（可留空）',goal.ends_on,{type:'date',change:v=>goal.ends_on=v||null});list.append(box);
 }};draw();panel.append(list);
 const add=h.el('div','dialog-actions');for(const [kind,label] of Object.entries(goalKinds))add.append(h.button('＋ '+label,()=>{const expected={stage:'strategy',month:'stage'}[kind],parent=doc.goals.find(g=>g.kind===expected);if(expected&&!parent)throw new Error('请先新增'+goalKinds[expected]+'。');doc.goals.push({id:crypto.randomUUID(),kind,parent_id:parent?.id??null,title:'',description:'',success_criteria:'',period:'',starts_on:null,ends_on:null,status:'planned',progress:null,current_state:'',next_step:''});draw();}));panel.append(add);
 let dirty=false;panel.addEventListener('input',event=>{if(event.target!==agree)dirty=true;});add.addEventListener('click',()=>dirty=true);
 const status=h.el('p','muted','草稿版本 '+data.draft_version+' · 正式版本 '+data.published_version),save=h.button('保存战略草稿',async()=>{save.disabled=true;try{await actions.save({authorized:true,expected_version:data.draft_version,document:doc});}finally{save.disabled=false;}},'primary');save.id='strategy-save-draft';
 const check=h.el('label','check'),agree=h.el('input');agree.type='checkbox';agree.id='strategy-publish-confirm';check.append(agree,document.createTextNode('我已核对并确认发布当前已保存草稿，作为 Agent 的正式目标。'));
 const publish=h.button('发布给所有获授权 Agent',async()=>{if(dirty)throw new Error('草稿尚有未保存修改，请先保存再发布。');if(!agree.checked)throw new Error('请先勾选发布确认。');publish.disabled=true;try{await actions.publish({authorized:true,expected_draft_version:data.draft_version,expected_published_version:data.published_version});}finally{publish.disabled=false;}},'primary');publish.id='strategy-publish';publish.disabled=!data.draft_version;
 panel.append(status,save,check,publish);wrap.append(panel);return wrap;
}
