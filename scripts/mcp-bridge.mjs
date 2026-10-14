import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { loadCredentials, options } from './lib.mjs';

// stdout is exclusively MCP protocol. The cloud service owns all memory storage.
const args=options();
const credential=await loadCredentials(args['credential-file'],args.client??'codex');
const remote=new Client({name:'personal-memory-hub-bridge',version:'0.1.0'});
await remote.connect(new StreamableHTTPClientTransport(new URL(credential.endpoint+'/mcp'),{authProvider:{token:async()=>credential.token}}));
const server=new Server({name:'personal-memory-hub',version:'0.1.0'},{capabilities:{tools:{}}});
server.setRequestHandler('tools/list',()=>remote.listTools());
server.setRequestHandler('tools/call',req=>remote.callTool(req.params));
server.onerror=()=>process.stderr.write('Personal Memory Hub bridge: protocol error. Check endpoint, expiration and permissions.\n');
const close=async()=>{await Promise.allSettled([remote.close(),server.close()]);process.exit(0);};
process.on('SIGINT',close);process.on('SIGTERM',close);process.stdin.on('end',close);
await server.connect(new StdioServerTransport());
