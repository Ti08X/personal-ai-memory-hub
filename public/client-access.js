export const accessLevels=[
 {label:'L0 · 公开资料',name:'公开',example:'公开简介、可分享的知识',range:'L0'},
 {label:'L1 · 普通个人资料',name:'普通',example:'一般偏好、项目介绍、普通计划',range:'L0–L1'},
 {label:'L2 · 私密资料与聊天',name:'私密',example:'私密聊天、个人经历、未公开的账号资料',range:'L0–L2'},
 {label:'L3 · 高敏感资料',name:'高敏感',example:'你明确标为严格授权的私人内容',range:'L0–L3'}
];
export function openClawConfig(origin,key='YOUR_API_KEY'){
 return {mcp:{servers:{personal_memory_hub:{url:new URL('/mcp',origin).href,transport:'streamable-http',connectionTimeoutMs:10000,requestTimeoutMs:30000,headers:{Authorization:'Bearer '+key}}}}};
}
export function openClawSkillConfig(origin,key='YOUR_API_KEY'){
 return {skills:{entries:{'personal-ai-memory-hub':{enabled:true,apiKey:key,env:{PMH_BASE_URL:new URL('/v1',origin).href}}}}};
}
export function openClawInstructions(origin){
 return `先确认个人记忆 Skill 已加载和实际通道可用，不能假定只发 URL/Key 就已配置 MCP。安装说明：${new URL('/memory-skill-setup.md',origin).href}。
优先使用实际发现的 personal_memory_hub MCP，地址 ${new URL('/mcp',origin).href}。没有原生 MCP 工具时，用 Skill 附带的 hub_client.py check 验证 REST 通道，由私有环境 PMH_API_KEY 持有认证；不要临时拼带占位 Key 的 curl。连接成功、工具发现和 AI 实际调用分别核对。API Key 不读取、复述或保存到聊天和记忆中。

开始工作：先调用 get_handoff({})、get_profile({}) 和 get_context({limit:20})，只读简短概要、主线任务与近期计划；不要一次性加载全部历史。
查找细节及过去经历：search_memory({query:"具体问题或主题",mode:"hybrid",rerank:true,limit:10}) 搜索当前凭证获授权的集合；不能根据近期上下文或概要判断没有旧历史。认证/权限错误、isError:true、ok:false 是失败，不是空结果；成功后核对数量、引用和来源再回答。检查 search_mode、degraded、reason，模型限额降级时可用 keyword、rerank:false。关键词空页也要按 next_cursor 翻页，未查完明确说明。使用 citation.record_id/版本回读原文，区分一般讨论与本人经历。安装的 Skill 定义完整判断流程。
保存信息：只保存用户明确授权、且当前客户端实际取得的信息。遵守来源、时间范围、敏感等级和用途限制。save_memory 必须带 authorized:true、真实 source_platform、source_kind、原 timestamp、稳定 logical_key 或 source_record_id、text、sensitivity。推断不当作个人事实；基于资料整理的内容标为 assistant_summary 并附 evidence:[{id,version}]。
更新信息：先读取现有记录和版本，再带 expected_version 更新同一稳定 ID。遇到 memory_conflict 或版本变化，保留候选并报告差异，不自动覆盖、不自行降低敏感等级。
存聊天：import_conversation 每批最多 10 条，保留原平台、session_id、稳定消息 id、role、timestamp、content 与每条 sensitivity。仅提供部分原文用 partial；只有摘要用 summary；确有完整材料才用 full。重试复用原 ID；检查每条结果、conflicts，再回读校验，不能只看 HTTP 成功。
账号资料：list_social_accounts / save_social_account 只存链接、用途、备注；不得保存账号密码或 Cookie。
权限：读取和写入上限分别由 Key 决定，且受操作权限和资料集合限制。L3 也不是管理员。密码、验证码、API Key、内部推理、工具原始负载和系统指令不上传。
如 MCP 工具不可用，明确报告，并可按 ${new URL('/v1',origin).href} 的 Bearer REST 接口适配；不要模拟工具结果。接通 MCP 不代表可自动采集其它平台私有历史。详细协议：${new URL('/openclaw-quickstart.md',origin).href}`;
}
export function openClawPluginConfig(origin,key='YOUR_API_KEY'){
 return {plugins:{entries:{'personal-ai-memory-hub':{enabled:true,hooks:{allowConversationAccess:true,allowPromptInjection:true},config:{baseUrl:new URL('/v1',origin).href,apiKey:key,agentIds:['main'],autoRecall:true,autoArchive:true,archiveAuthorized:true,autoSummary:true,summaryAuthorized:true,sensitivity:'sensitive'}}}}};
}
export function permissionTable(el){
 const box=el('div','access-levels'),table=el('table'),head=el('tr');
 for(const text of ['等级','内容例子','读取上限','写入上限'])head.append(el('th','',text));table.append(head);
 for(const [n,v] of accessLevels.entries()){
  const row=el('tr');for(const text of ['L'+n+' '+v.name,v.example,'可读 '+v.range,'可创建／更新 '+v.range])row.append(el('td','',text));table.append(row);
 }
 const scroll=el('div','table-scroll');scroll.append(table);
 box.append(scroll,el('p','muted','等级是累计的敏感上限，L0 也需要认证。实际权限还要同时满足操作勾选和资料集合。L3 不授予后台管理、删除会话或修改模型设置的权限；密码、验证码和 API Key 不属于记忆资料。'));
 return box;
}
