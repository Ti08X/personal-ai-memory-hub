// Retain old workers.dev API URLs without maintaining a second writable database.
export {MemoryLibraryWorkflow} from './library-workflow';
export default {
 async scheduled(){},
 async fetch(req:Request){
  const source=new URL(req.url),target=new URL(source.pathname+source.search,'https://pw.zgatri.com');
  if(source.hostname==='pw.zgatri.com')return Response.json({error:'legacy_route_misconfigured'},{status:503});
  if(!source.pathname.startsWith('/v1/')&&source.pathname!=='/mcp'&&source.pathname!=='/health')return Response.redirect(target.href,302);
  // Credential headers remain in the server-to-server request; never in a URL.
  const result=await fetch(new Request(target,req),{redirect:'manual'});
  return new Response(result.body,{status:result.status,headers:result.headers});
 }
};
