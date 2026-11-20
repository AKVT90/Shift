const {chromium,devices}=require('playwright');const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.join(__dirname,'..');let versionOverride=null;
const mime={js:'text/javascript',css:'text/css',html:'text/html',png:'image/png',json:'application/json',webmanifest:'application/manifest+json',gz:'application/gzip'};
const app=http.createServer((q,r)=>{const u=q.url.split('?')[0];const f=path.join(root,u==='/'?'index.html':u);
 if(u==='/version.js'&&versionOverride){r.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'max-age=600'});return r.end(`self.SHIFT_VERSION='${versionOverride}';`)}
 fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);r.end();return}r.writeHead(200,{'Content-Type':mime[f.split('.').pop()]||'application/octet-stream','Cache-Control':'max-age=600'});r.end(d)})}).listen(8765);
// "Worker" falso com CORS
let calls=[],failing=false,stored=null;
const W=http.createServer((q,r)=>{const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,PUT,OPTIONS'};
 if(q.method==='OPTIONS'){r.writeHead(204,C);return r.end()}
 if(failing){r.destroy();return}
 let b='';q.on('data',d=>b+=d);q.on('end',()=>{calls.push({m:q.method,auth:q.headers.authorization,url:q.url,n:(b.match(/BEGIN:VEVENT/g)||[]).length});
  if(q.headers.authorization!=='Bearer s3cret!'){r.writeHead(401,C);return r.end('Unauthorized')}stored=b;r.writeHead(200,C);r.end('ok')})}).listen(8789);
const log=(...a)=>console.log(...a);
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({...devices['iPhone 14']});const p=await ctx.newPage();
p.on('pageerror',e=>log('PAGEERR',e.message));p.on('console',m=>{if(m.type()==='error')log('CONSOLE.ERR',m.text().slice(0,200))});
// --- migração de estado v1 com segredo e nome antigo
await p.goto('http://localhost:8765/');
await p.evaluate(()=>{localStorage.clear();localStorage.setItem('shift.v1',JSON.stringify({v:1,months:{'2026-10':{'2026-10-05':{date:'2026-10-05',type:'work',start:'11:00',end:'15:00'}}},imports:[],settings:{shortcutName:'SHIFT Alarmes',worker:{url:'http://localhost:8789',token:'t'.repeat(40),secret:'s3cret!'}},icsSeq:2}))});
await p.reload();await p.waitForTimeout(500);
let st=await p.evaluate(()=>({state:localStorage.getItem('shift.v1'),sec:localStorage.getItem('shift.secret')}));
assert(!st.state.includes('s3cret!'),'segredo ainda no estado');assert.strictEqual(st.sec,'s3cret!');
assert(JSON.parse(st.state).settings.shortcutName==='SHIFT Alarms');assert(JSON.parse(st.state).months['2026-10']);log('✓ migração v1: dados mantidos, segredo separado, atalho renomeado');
// --- OCR real, ficheiros self-hosted
await p.click('[data-tab=importar]');
await p.setInputFiles('#files',[root+'/test/synth.png']);
const t0=Date.now();await p.waitForSelector('#goOn',{timeout:120000});log('✓ OCR local concluído em',((Date.now()-t0)/1000).toFixed(1),'s');
const info=await p.evaluate(()=>{const g=window.__shift.state;return document.querySelector('h2').textContent+' | '+document.querySelectorAll('.cell[data-d]').length+' dias | doubt '+document.querySelectorAll('.cell.doubt').length+' | mês '+document.querySelector('[data-mm]').value+'/'+document.querySelector('[data-yy]').value});log('  preview:',info);
await p.screenshot({path:'prev.png'});
const types=await p.evaluate(()=>[...document.querySelectorAll('.cell[data-d]')].map(c=>[+c.dataset.d,c.className.match(/t-(\w+)/)?.[1]||'none',c.classList.contains('swap')]));
const truth=JSON.parse(fs.readFileSync(root+'/test/synth.json')).truth;let bad=0;for(const [d,t,sw] of types){if(!truth[d])continue;if(truth[d].type!==t||truth[d].swap!==sw){bad++;log('  ✗ dia',d,truth[d],t,sw)}}log('  dias errados no preview:',bad,'/30');
await p.click('#goOn');await p.click('#apply');await p.waitForTimeout(400);
// --- publicação em fila + falha + recuperação
st=await p.evaluate(()=>window.__shift.state.sync);log('  sync após importar:',JSON.stringify(st));
await p.waitForTimeout(800);log('  chamadas ao worker:',calls.length,'auth ok:',calls.every(c=>c.auth==='Bearer s3cret!'),'eventos no último PUT:',calls.at(-1)?.n);
assert(calls.length>=1&&calls.at(-1).n>0);
failing=true;calls=[];
await p.evaluate(()=>{const S=window.__shift.state;const k=Object.keys(S.months['2026-11'])[3];S.months['2026-11'][k].notes='alterado';window.__shift.render()});
await p.click('[data-tab=horarios]');await p.evaluate(()=>document.querySelector('.cell[data-k="2026-11-10"]').click());await p.fill('#eN','teste');await p.click('#eSave');await p.waitForTimeout(1500);
let pend=await p.evaluate(()=>window.__shift.state.sync.pending);log('✓ falha de rede → pendente:',pend);assert(pend);
const warnTxt=await p.textContent('#syncBox');log('  UI:',warnTxt.trim());
failing=false;await p.evaluate(()=>window.dispatchEvent(new Event('online')));await p.waitForTimeout(1500);
pend=await p.evaluate(()=>window.__shift.state.sync.pending);log('✓ voltou a rede → publicado, pendente:',pend,'| chamadas:',calls.length);assert(!pend&&stored.includes('BEGIN:VCALENDAR'));
// --- persistência: reabrir
await p.reload();await p.waitForTimeout(600);
let n=await p.evaluate(()=>Object.keys(window.__shift.state.months).sort().join(','));log('✓ depois de reabrir:',n);assert(n==='2026-10,2026-11');
// --- backup não contém segredo
const bk=await p.evaluate(async()=>{let txt='';const orig=window.File;window.File=function(parts,name,o){txt=parts.join('');return new orig(parts,name,o)};Object.defineProperty(navigator,'canShare',{value:()=>false,configurable:true});const a=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){};await window.__shift.exportBackup();return txt});
assert(!bk.includes('s3cret!'));assert(bk.includes('"2026-11"'));log('✓ backup sem palavra-passe, com',(bk.match(/"type"/g)||[]).length,'dias');
// --- recuperação: apagar localStorage -> aviso e restauro a partir do IndexedDB
await p.waitForTimeout(1000);
await p.evaluate(()=>{localStorage.removeItem('shift.v1')});await p.reload();await p.waitForSelector('#cOk',{timeout:5000});
log('✓ dados apagados do localStorage → app oferece restaurar:',(await p.textContent('.sheet p')).slice(0,90));
await p.click('#cOk');await p.waitForTimeout(800);n=await p.evaluate(()=>Object.keys(window.__shift.state.months).sort().join(','));log('  restaurado:',n);assert(n==='2026-10,2026-11');
// --- estado corrompido
await p.evaluate(()=>localStorage.setItem('shift.v1','{corrompido'));await p.reload();await p.waitForTimeout(800);
const cor=await p.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('shift.corrupt.')).length);log('✓ JSON corrompido preservado em',cor,'chave(s); recuperação oferecida:',!!(await p.$('#cOk')));assert(cor===1);
if(await p.$('#cOk'))await p.click('#cOk');await p.waitForTimeout(600);
// --- service worker: offline + atualização
await p.evaluate(()=>navigator.serviceWorker.ready);await p.waitForTimeout(500);
await ctx.setOffline(true);await p.reload();await p.waitForTimeout(500);log('✓ offline: página abre →',await p.textContent('.brand b'),'| meses:',await p.evaluate(()=>Object.keys(window.__shift.state.months).length));
await ctx.setOffline(false);
versionOverride='9999.test';await p.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update()});await p.waitForTimeout(1500);
const upd=await p.evaluate(()=>!document.querySelector('#upd').hidden);log('✓ nova versão detetada → banner de atualização:',upd);assert(upd);
await p.reload();await p.waitForTimeout(500);log('  versão em execução após recarregar:',await p.evaluate(()=>self.SHIFT_VERSION));
await p.screenshot({path:'home.png'});
await b.close();app.close();W.close()})().catch(e=>{console.error('FALHOU',e);process.exit(1)});
