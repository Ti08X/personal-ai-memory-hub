import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveRange,archiveQuery} from '../public/archive-ui.js';
test('archive presets use Shanghai dates and inclusive calendar ranges across month and year boundaries',()=>{
 assert.deepEqual(archiveRange('today','2026-10-14T16:00:00Z'),{from:'2026-10-15',to:'2026-10-15'});
 assert.deepEqual(archiveRange('yesterday','2026-01-01T00:00:00Z'),{from:'2025-12-31',to:'2025-12-31'});
 assert.deepEqual(archiveRange('seven','2026-01-03T00:00:00Z'),{from:'2025-12-28',to:'2026-01-03'});
 assert.deepEqual(archiveRange('previous-month','2024-03-01T00:00:00Z'),{from:'2024-02-01',to:'2024-02-29'});
 assert.deepEqual(archiveRange('month','2026-10-14T16:00:00Z'),{from:'2026-10-01',to:'2026-10-15'});
 assert.deepEqual(archiveRange('all'),{from:'',to:''});
});
test('archive range query includes the full final day and refuses reversed or nonexistent dates',()=>{
 const q=archiveQuery({source:'example-platform',from:'2026-10-14',to:'2026-10-15',cursor:30});
 assert.equal(q.get('since'),'2026-10-14T00:00:00+08:00');assert.equal(q.get('until'),'2026-10-15T23:59:59.999+08:00');assert.equal(q.get('source_platform'),'example-platform');assert.equal(q.get('cursor'),'30');assert.equal(q.get('include_summary'),'true');
 assert.throws(()=>archiveQuery({from:'2026-10-15',to:'2026-10-14'}),/开始日期/);assert.throws(()=>archiveQuery({from:'2026-02-30'}),/有效日期/);
 assert.equal(archiveQuery({}).has('since'),false);assert.equal(archiveQuery({}).has('source_platform'),false);
});
