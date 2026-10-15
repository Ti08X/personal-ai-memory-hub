import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreSessionOrInitializeAuth} from '../public/auth-bootstrap.js';

test('a rejected session restoration still initializes the login screen',async()=>{
 let restored=false,initialized=false;
 const result=await restoreSessionOrInitializeAuth(
  async()=>{throw new TypeError('temporary network failure');},
  async()=>{restored=true;},
  async()=>{initialized=true;}
 );
 assert.equal(result,'login');
 assert.equal(restored,false);
 assert.equal(initialized,true);
});

test('an unauthenticated response initializes login without restoring a session',async()=>{
 let initialized=false;
 const result=await restoreSessionOrInitializeAuth(
  async()=>({ok:false}),
  async()=>assert.fail('must not restore a rejected session'),
  async()=>{initialized=true;}
 );
 assert.equal(result,'login');
 assert.equal(initialized,true);
});

test('a valid session restores the workspace and skips login initialization',async()=>{
 let received,initialized=false;
 const result=await restoreSessionOrInitializeAuth(
  async()=>({ok:true,json:async()=>({client_id:'test'})}),
  async value=>{received=value;},
  async()=>{initialized=true;}
 );
 assert.equal(result,'restored');
 assert.deepEqual(received,{client_id:'test'});
 assert.equal(initialized,false);
});

test('malformed session JSON falls back to login',async()=>{
 let initialized=false;
 const result=await restoreSessionOrInitializeAuth(
  async()=>({ok:true,json:async()=>{throw new SyntaxError('invalid JSON');}}),
  async()=>assert.fail('must not restore malformed session'),
  async()=>{initialized=true;}
 );
 assert.equal(result,'login');
 assert.equal(initialized,true);
});

test('workspace rendering errors propagate instead of masquerading as a missing session',async()=>{
 let initialized=false;
 await assert.rejects(restoreSessionOrInitializeAuth(
  async()=>({ok:true,json:async()=>({client_id:'test'})}),
  async()=>{throw new ReferenceError('synthetic workspace error');},
  async()=>{initialized=true;}
 ),ReferenceError);
 assert.equal(initialized,false);
});
