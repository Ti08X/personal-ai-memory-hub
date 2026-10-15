export const categoryLabels={personal:'个人信息',development:'开发项目',work:'工作事业',health:'生活健康',learning:'学习研究',other:'其他讨论',unclassified:'未分类'};
export const stateLabels={confirmed:'有明确陈述',discussed:'讨论过',planned:'计划中',in_progress:'进行中',completed:'已完成',blocked:'有阻塞',unknown:'待确认'};
const paths={records:['M5 4h14v16H5z','M8 8h8M8 12h8M8 16h5'],plus:['M12 5v14M5 12h14'],personal:['M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0','M4 21v-2a8 8 0 0 1 16 0v2'],development:['m8 6-6 6 6 6','m16 6 6 6-6 6','m14 3-4 18'],classified:['m4 12 5 5L20 5'],pending:['M12 3a9 9 0 1 0 9 9','M12 7v6l4 2']};
export function metric(label,value,foot,name,h){
 const box=h.el('div','stat metric-card'),icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');icon.classList.add('metric-icon');
 for(const d of paths[name]??paths.records){const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d',d);icon.append(path);}
 box.append(icon,h.el('div','stat-label',label),h.el('div','stat-value',String(value??0)),h.el('div','stat-foot',foot));return box;
}
export function categoryChart(counts,h){
 const panel=h.card('记忆分类','按当前权限统计原始资料；个人与开发主题可重叠'),layout=h.el('div','classification-chart');
 const total=counts.total_sources||0,done=counts.classified||0,ring=h.el('div','classification-ring');ring.style.setProperty('--classified-percent',String(total?Math.round(done/total*100):0)+'%');
 ring.append(h.el('strong','',String(done)),h.el('span','','已分类 / '+total));layout.append(ring);
 const bars=h.el('div','category-bars');for(const [key,value] of [['personal',counts.personal],['development',counts.development],...['work','health','learning'].filter(key=>counts[key]).map(key=>[key,counts[key]]),['other',counts.other],['unclassified',counts.unclassified]]){
  const row=h.el('div','category-bar'),label=h.button(categoryLabels[key],()=>h.openCategory(key),'quiet'),bar=h.el('progress');bar.max=Math.max(1,total);bar.value=value||0;row.append(label,h.el('strong','',String(value||0)),bar);bars.append(row);
 }
 layout.append(bars);panel.append(layout,h.el('p','muted','分类表示资料涉及的主题；个人事实和项目完成状态需要原文证据。未整理的内容会明确保留为未分类。'));return panel;
}
function references(ids,h){const actions=h.el('div','evidence-links');for(const id of ids){const version=h.evidenceIndex?.[id]?.version;actions.append(h.button('↗ '+id.slice(0,12)+'…'+(version?' · v'+version:''),()=>h.openSource(id,version),'quiet'));}return actions;}
function claims(items,h){const list=h.el('div','overview-claims');for(const item of items){const row=h.el('article','overview-claim');row.append(h.el('span','badge',stateLabels[item.status]??'待确认'),h.el('p','',item.text));if(item.project)row.append(h.el('small','muted',item.project));row.append(references(item.evidence_ids,h));list.append(row);}if(!items.length)list.append(h.el('p','muted','暂未提取到当前权限下有证据的内容。'));return list;}
export function projectTable(projects,h){
 const wrap=h.el('div','overview-table-wrap'),table=h.el('table','overview-project-table'),head=h.el('tr');for(const title of ['项目 / 目标','状态','当前进度','下一步','出处'])head.append(h.el('th','',title));table.append(head);
 for(const project of projects){const row=h.el('tr'),name=h.el('td');name.append(h.el('strong','',project.name),h.el('p','muted',project.goal));row.append(name,h.el('td','',stateLabels[project.status]??'待确认'),h.el('td','',project.current_step||'暂无明确证据'),h.el('td','',project.next_step||'待确定'));const refs=h.el('td');refs.append(references(project.evidence_ids,h));row.append(refs);table.append(row);if(project.blockers){const block=h.el('tr'),cell=h.el('td','muted','阻塞：'+project.blockers);cell.colSpan=5;block.append(cell);table.append(block);}}
 wrap.append(table);if(!projects.length)wrap.append(h.el('p','muted','尚未提取到有证据的开发项目。'));return wrap;
}
export function summaryPanel(data,h,detailed=false){
 h={...h,evidenceIndex:data.evidence_index};
 const panel=h.card(data.summary_title??(detailed?'个人总概览 · 详细版':'个人与执行现状总概览'),data.updated_at?'版本 '+data.version+' · '+h.date(data.updated_at):'尚未生成'),summary=data.overview;
 const coverage=data.coverage;panel.append(h.el('p','muted',coverage?'已纳入 '+coverage.included_sources+' / '+coverage.available_sources+' 条已提交资料。'+(data.status==='updating'?'尚有资料等待增量整理。':''):'已分类 '+data.counts.classified+' / '+data.counts.total_sources+' 条已提交资料。'));if(data.historical)panel.append(h.el('p','error','这是旧版概要，仅供回溯。引用绑定当时的原文版本，不能直接当成当前事实。'));
 if(!summary){panel.append(h.el('p','overview-empty',data.status==='stale_or_scope_restricted'?'来源已更新或当前权限不能读取完整概要；旧内容暂停展示。':'开始整理后，这里会出现个人情况、开发项目、主线进度和下一步。'));}
 else{
  panel.append(h.el('p','overview-brief',summary.brief||'暂无精简概括。'));
  if(detailed){for(const [key,title] of [['personal','个人信息与偏好'],['projects','开发项目 · 当前进度与下一步'],['mainline','个人主线任务'],['next_actions','近期计划与下一步']]){const section=h.el('section','overview-section');section.id='overview-'+key;section.append(h.el('h3','',title),key==='projects'?projectTable(summary.projects,h):claims(summary[key],h));panel.append(section);}}
  else{
   const columns=h.el('div','columns');for(const [key,title] of [['mainline','正在推进'],['next_actions','接下来做什么']]){const group=h.el('div');group.append(h.el('h3','',title),claims(summary[key].slice(0,3),h));columns.append(group);}panel.append(columns);
  }
 }
 if(data.organization_error)panel.append(h.el('p','error',({model_service_unavailable:'概要模型暂时无法连接，请检查服务设置后重试。',model_provider_rate_limit:'模型供应商临时限流，请稍后重试。',model_request_timeout:'概要模型响应超时，已保留原文与已完成的提取，可稍后继续。',summary_envelope_invalid:'模型响应格式不兼容，请核对模型 API 是否返回标准聊天补全格式。',summary_response_truncated:'模型输出被截断，本次没有保存概要。请换用支持更长输出的模型后重试。',summary_json_invalid:'模型没有返回有效 JSON，本次没有保存概要。',invalid_summary_response:'模型返回格式不符合要求，请检查概要模型后重试。',summary_evidence_invalid:'模型返回了无效出处，本次概要没有保存。',evidence_version_changed:'来源刚刚更新，将根据新版本继续整理。',summary_not_configured:'请先配置并启用概要模型。'}[data.organization_error]??'整理服务暂时不可用（'+data.organization_error+'）。')+' 已保存的原文和分类仍可查看。'));
 panel.append(h.el('p','muted','Agent 先读取本人发布的战略目标，再看这里的个人与执行现状；自动提取的进度与建议不能更改正式目标。'));
 return panel;
}
