import {definePluginEntry,buildJsonPluginConfigSchema} from 'openclaw/plugin-sdk/plugin-entry';
import {readFileSync} from 'node:fs';
import {registerMemory} from './runtime.mjs';
const manifest=JSON.parse(readFileSync(new URL('./openclaw.plugin.json',import.meta.url),'utf8'));
export default definePluginEntry({id:'personal-ai-memory-hub',name:'Personal AI Memory Hub',description:'Automatic private context recall and authorized conversation capture with encrypted retry storage.',configSchema:()=>buildJsonPluginConfigSchema(manifest.configSchema),register:registerMemory});
