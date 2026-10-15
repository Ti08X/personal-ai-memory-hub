import {DatabaseSync} from 'node:sqlite';
import {chmodSync, mkdirSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, join} from 'node:path';

// The app uses SQLite in both runtimes. Keep SQL, FTS, transactions and CAS rules
// identical; never emulate a transaction using separately awaited statements.
export function database(path, migrations) {
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const sqlite=new DatabaseSync(path);
 if(path!==':memory:')chmodSync(path,0o600);
 sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000; PRAGMA synchronous=FULL;');
 if(migrations){
  sqlite.exec('CREATE TABLE IF NOT EXISTS server_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  for(const name of readdirSync(migrations).filter(x=>/^\d+.*\.sql$/.test(x)).sort()){
   if(sqlite.prepare('SELECT 1 FROM server_migrations WHERE name=?').get(name))continue;
   sqlite.exec('BEGIN IMMEDIATE');
   try{if(!sqlite.prepare('SELECT 1 FROM server_migrations WHERE name=?').get(name)){sqlite.exec(readFileSync(join(migrations,name),'utf8'));sqlite.prepare('INSERT INTO server_migrations VALUES(?,?)').run(name,new Date().toISOString());}sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}
  }
 }
 function prepare(sql,values=[]){
  const execute=()=>{const r=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};};
  return {bind(...args){return prepare(sql,args);},execute,
   async run(){return execute();},
   async first(column){const row=sqlite.prepare(sql).get(...values);return column?(row?.[column]??null):(row??null);},
   async all(){return {success:true,results:sqlite.prepare(sql).all(...values),meta:{}};}
  };
 }
 return {sqlite,prepare,async batch(statements){
  sqlite.exec('BEGIN IMMEDIATE');
  try{const result=statements.map(s=>s.execute());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}
 },close(){sqlite.close();}};
}
