const enc = new TextEncoder();
const bytes64 = (s:string) => Uint8Array.from(atob(s), c=>c.charCodeAt(0));
const hex = (b:Uint8Array) => Array.from(b, v=>v.toString(16).padStart(2,'0')).join('');

// Production Workers cap each PBKDF2 operation at 100,000 iterations.
// A post-hash server pepper also protects hashes if only D1 is exposed.
export async function derivePassword(password:string,salt:string,serverKey:string) {
 const material=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
 const derived=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:bytes64(salt),iterations:100000},material,256);
 const raw=bytes64(serverKey);
 if(raw.length!==32)throw new Error('password_pepper_not_configured');
 const master=await crypto.subtle.importKey('raw',raw,'HKDF',false,['deriveKey']);
 const pepper=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:enc.encode('personal-ai-memory-hub-v1'),info:enc.encode('dashboard-password-pepper-v1')},master,{name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
 const digest=await crypto.subtle.sign('HMAC',pepper,derived);
 return 'pbkdf2-sha256-100k-pepper-v1$'+hex(new Uint8Array(digest));
}
