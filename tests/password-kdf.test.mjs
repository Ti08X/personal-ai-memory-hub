import test from 'node:test';
import assert from 'node:assert/strict';
import {derivePassword} from '../src/password-kdf.ts';

test('password hashing works under the production Workers iteration cap and binds salt and server pepper',async()=>{
 const original=crypto.subtle.deriveBits.bind(crypto.subtle);
 crypto.subtle.deriveBits=async(algorithm,...args)=>{
  if(algorithm.name==='PBKDF2'&&algorithm.iterations>100000)throw new DOMException('production iteration cap','NotSupportedError');
  return original(algorithm,...args);
 };
 const salt=btoa('synthetic-salt-01'),pepper=btoa('a'.repeat(32));
 try {
  const result=await derivePassword('synthetic-test-password',salt,pepper);
  assert.equal(result,await derivePassword('synthetic-test-password',salt,pepper));
  assert.notEqual(result,await derivePassword('other-synthetic-password',salt,pepper));
  assert.notEqual(result,await derivePassword('synthetic-test-password',btoa('synthetic-salt-02'),pepper));
  assert.notEqual(result,await derivePassword('synthetic-test-password',salt,btoa('b'.repeat(32))));
  await assert.rejects(derivePassword('synthetic-test-password',salt,btoa('short')),/pepper_not_configured/);
 } finally {crypto.subtle.deriveBits=original;}
});
