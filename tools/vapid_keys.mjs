// Generates a VAPID key pair for the daily reminder (Web Push).
//   node tools/vapid_keys.mjs
// Public key: paste into VAPID_PUBLIC_KEY in reminder.js and set it as a secret.
// Private key: only ever a Supabase secret (never commit it).
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const pub = Buffer.from(await crypto.subtle.exportKey('raw', publicKey)).toString('base64url');
const { d } = await crypto.subtle.exportKey('jwk', privateKey);
console.log(`VAPID_PUBLIC_KEY=${pub}\nVAPID_PRIVATE_KEY=${d}`);
