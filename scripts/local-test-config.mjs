// Isolated tests must never use the production Vectorize binding or model services.
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
export async function localTestConfig(directory){
 const project=resolve(new URL('..',import.meta.url).pathname);
 const config=JSON.parse(await readFile(join(project,'wrangler.jsonc'),'utf8'));
 delete config.vectorize;delete config.routes;delete config.triggers;
 config.main=join(project,'src/index.ts');
 config.assets.directory=join(project,'public');
 for(const database of config.d1_databases)database.migrations_dir=join(project,'migrations');
 config.vars={RAG_ENABLED:'false',SUMMARY_BASE_URL:'',SUMMARY_MODEL:''};
 const file=join(directory,'wrangler.local-test.json');
 await writeFile(file,JSON.stringify(config),{mode:0o600});return file;
}
