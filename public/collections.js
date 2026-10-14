export async function digest(text) {
 const bytes = new TextEncoder().encode(text);
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
}
export function publicUrl(value, optional = false) {
 if (!value.trim() && optional) return '';
 let url; try { url = new URL(value.trim()); } catch { throw new Error('请填写完整的 HTTPS 主页链接。'); }
 if (url.protocol !== 'https:' || url.username || url.password || url.search) throw new Error('请使用不含登录信息和查询参数的 HTTPS 主页链接。');
 url.hash = ''; return url.href.replace(/\/$/, '');
}
export async function accountRecord(fields) {
 const platform = fields.platform.trim(), url = publicUrl(fields.url);
 if (!platform || platform.length > 64) throw new Error('请填写账号平台（最多 64 字）。');
 if (!['active', 'archived'].includes(fields.status)) throw new Error('账号状态不正确。');
 const data = {category:'social_account', platform, url, handle:fields.handle.trim(), display_name:fields.display_name.trim(), purpose:fields.purpose.trim(), notes:fields.notes.trim(), status:fields.status};
 if (Object.values(data).some(v => v.length > 2000)) throw new Error('单个账号字段最多 2,000 字。');
 return {record_type:'profile',logical_key:'accounts.'+(await digest(platform.toLowerCase()+'\n'+url)).slice(0,40), title:(data.display_name || data.handle || platform)+' · '+platform,text:[platform+' '+data.handle, data.display_name, url, data.purpose, data.notes, '状态：'+data.status].filter(Boolean).join('\n'),data,tags:['social-account',platform]};
}
export async function knowledgeRecords(text, filename, sourceUrl = '', tags = []) {
 if (!/\.(md|txt)$/i.test(filename)) throw new Error('目前支持 Markdown 和 UTF-8 纯文本文件。');
 if (!text.trim() || text.includes('\u0000')) throw new Error('文件没有可归档的文本，或含有二进制内容。');
 if (new TextEncoder().encode(text).length > 256*1024) throw new Error('单份知识资料上限 256 KB，请先按主题拆分。');
 if (filename.length > 180) throw new Error('文件名过长，请缩短到 180 字以内。');
 const source_url = publicUrl(sourceUrl, true), content_hash = await digest(text), document_id = await digest(filename+'\n'+content_hash), chars = Array.from(text), chunks=[];
 let line = 1;
 for (let start=0; start<chars.length; start+=4000) {
  const part=chars.slice(start,start+4000).join(''), endLine=line+(part.match(/\n/g)||[]).length;
  const index=chunks.length;
  chunks.push({record_type:'memory',logical_key:'knowledge.'+document_id+'.'+index,session_id:'knowledge:'+document_id,source_record_id:document_id+':'+index,title:filename+' · 第 '+(index+1)+' 段',text:part,data:{category:'knowledge_document',document_id,content_hash,filename,source_url,chunk_index:index,chunk_count:Math.ceil(chars.length/4000),start_offset:start,end_offset:Math.min(start+4000,chars.length),offset_unit:'unicode_codepoint',line_start:line,line_end:endLine},tags:['knowledge-document',...tags]});
  line=endLine;
 }
 return chunks;
}
