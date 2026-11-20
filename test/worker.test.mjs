import w from '../worker/worker.js';import assert from 'assert';
const kv=new Map(),env={SECRET:'s3',CAL:{put:async(k,v)=>kv.set(k,v),get:async k=>kv.get(k)||null}};
const tok='a'.repeat(48),u=`https://x/cal/${tok}.ics`,ics='BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';
assert.strictEqual((await w.fetch(new Request(u,{method:'PUT',body:ics}),env)).status,401);
assert.strictEqual((await w.fetch(new Request(u,{method:'PUT',body:ics,headers:{Authorization:'Bearer s3'}}),env)).status,200);
const g=await w.fetch(new Request(u),env);assert.strictEqual(await g.text(),ics);assert(g.headers.get('content-type').startsWith('text/calendar'));
assert.strictEqual((await w.fetch(new Request('https://x/cal/curto.ics'),env)).status,404);
console.log('worker OK');
