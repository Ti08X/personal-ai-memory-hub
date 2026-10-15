import {build} from 'esbuild';
await build({entryPoints:['src/app.ts'],outfile:'server/app.bundle.mjs',bundle:true,platform:'node',format:'esm',target:'node24',packages:'external'});
await build({entryPoints:['src/core.ts'],outfile:'server/core.bundle.mjs',bundle:true,platform:'node',format:'esm',target:'node24',packages:'external'});
console.log('Portable server bundle built');
