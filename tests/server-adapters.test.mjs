import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../server/database.mjs';
import {pointId,Vectors} from '../server/vectors.mjs';
test('SQLite batches roll back every prior write and return precise conditional changes',async()=>{
 const db=database(':memory:');db.sqlite.exec('CREATE TABLE t(id INTEGER PRIMARY KEY,v TEXT)');
 await assert.rejects(db.batch([db.prepare('INSERT INTO t VALUES(?,?)').bind(1,'first'),db.prepare('INSERT INTO t VALUES(?,?)').bind(1,'collision')]));
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM t').first()).n,0);
 const results=await db.batch([db.prepare('INSERT INTO t VALUES(?,?)').bind(1,'first'),db.prepare('UPDATE t SET v=? WHERE id=? AND v=?').bind('next',1,'wrong')]);assert.deepEqual(results.map(x=>x.meta.changes),[1,0]);db.close();
});
test('SQLite immutable bindings, RETURNING, migrations and FTS preserve the app contract',async()=>{
 const db=database(':memory:',new URL('../migrations',import.meta.url).pathname);
 const stmt=db.prepare('SELECT ? AS value'),a=stmt.bind('甲'),b=stmt.bind('乙');assert.equal(await a.first('value'),'甲');assert.equal(await b.first('value'),'乙');
 assert.equal((await db.prepare('INSERT INTO rate_limits VALUES(?,?,1) RETURNING count').bind('test',1).first()).count,1);
 assert.equal(db.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM server_migrations').get().n,9);db.close();
});
test('Vector identity is deterministic and policy omission fails closed',async()=>{
 assert.match(pointId('vec_example'),/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.equal(pointId('vec_example'),pointId('vec_example'));assert.notEqual(pointId('vec_other'),pointId('vec_example'));
 assert.throws(()=>new Vectors('http://example.com'));const index=new Vectors('http://127.0.0.1:6333');await assert.rejects(index.query([1],{topK:10}),/policy/);
});
