import {copyFile,mkdir} from 'node:fs/promises';
await mkdir(new URL('../public/',import.meta.url),{recursive:true});
await copyFile(new URL('./import-format.mjs',import.meta.url),new URL('../public/import-format.js',import.meta.url));
