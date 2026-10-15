import {DatabaseSync,backup} from 'node:sqlite';
import {mkdir,writeFile,chmod,readdir,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
process.umask(0o077);
const root=process.env.BACKUP_DIR??'/backups',name='memory-'+new Date().toISOString().replaceAll(':','-')+'.sqlite';
await mkdir(root,{recursive:true,mode:0o700});
const db=new DatabaseSync(process.env.DATABASE_PATH??'/data/memory.sqlite',{readOnly:true});
await backup(db,join(root,name));db.close();await chmod(join(root,name),0o600);
const test=new DatabaseSync(join(root,name),{readOnly:true});if(test.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||test.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Backup verification failed');test.close();
const sha256=createHash('sha256').update(await readFile(join(root,name))).digest('hex');await writeFile(join(root,name+'.sha256'),sha256+'  '+name+'\n',{mode:0o600});
const old=(await readdir(root)).filter(p=>/^memory-.*\.sqlite$/.test(p)).sort().slice(0,-30);for(const file of old){await unlink(resolve(root,file));await unlink(resolve(root,file+'.sha256')).catch(()=>{});}
console.log(JSON.stringify({backup:'verified',file:name,retention:30}));
