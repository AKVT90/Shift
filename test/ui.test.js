const fs=require('fs'),path=require('path'),{JSDOM}=require('jsdom'),{PNG}=require('pngjs'),assert=require('assert');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(root+'/index.html','utf8').replace(/<script src="[^"]+"><\/script>/g,'');
const dom=new JSDOM(html,{url:'https://x.github.io/shift/',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;w.scrollTo=()=>{};
w.eval(fs.readFileSync(root+'/core.js','utf8'));w.eval(fs.readFileSync(root+'/app.js','utf8'));
const $=s=>w.document.querySelector(s),$$=s=>[...w.document.querySelectorAll(s)];
const png=PNG.sync.read(fs.readFileSync(__dirname+'/synth.png')),meta=JSON.parse(fs.readFileSync(__dirname+'/synth.json'));
const res=w.Core.analyse({width:png.width,height:png.height,data:png.data},meta.words,meta.text,w.Core.DEFAULT_REFS,new Date(2026,10,19));
const mk=()=>w.__shift.buildDraft([{res:JSON.parse(JSON.stringify(res)),thumb:'data:,',name:'a'}]);
const tab=t=>$(`[data-tab=${t}]`).click();
// 1) importar
tab('importar');w.__shift.setDraft(mk());w.__shift.render();
assert($$('.cell[data-d]').length===30,'30 dias no preview');
assert($('h2').textContent.includes('Confirmar'));
$('#goOn').click();
assert($('#apply'),'diff com botão guardar');
$('#apply').click();
let st=w.__shift.state;
assert.strictEqual(Object.keys(st.months['2026-11']).length,30);
assert.strictEqual(st.imports.length,1);
// 2) reimportar o mesmo → nada de novo
tab('importar');w.__shift.setDraft(mk());w.__shift.render();$('#goOn').click();
assert(!$('#apply')&&$('.sheet').textContent.includes('nada de novo'),'reimportação sem duplicar');
$('.sheet [data-close]').click();
assert.strictEqual(w.__shift.state.imports.length,1);
// 3) edição manual preservada
const workDay=Object.values(st.months['2026-11']).find(d=>d.type==='work'&&!d.swap).date;
w.__shift.openDay(workDay);$('#eS').value='14:00';$('#eE').value='18:00';$('#eSave').click();
assert.strictEqual(w.__shift.state.months['2026-11'][workDay].start,'14:00');
tab('importar');w.__shift.setDraft(mk());w.__shift.render();$('#goOn').click();
const box=$$('.sheet input[type=checkbox]');
assert(box.length===1&&!box[0].checked,'conflito manual desmarcado por defeito');
$('#apply').click();
assert.strictEqual(w.__shift.state.months['2026-11'][workDay].start,'14:00','edição manual preservada');
// 4) restaurar
tab('historico');assert($$('[data-rs]').length>=1);
// 5) alarmes (usar mês corrente para ter "futuros")
const fut=w.Core.dateKey(2026,11,25);
tab('alarmes');
const n=w.Core.activeAlarmTimes({type:'work',start:'11:00'},w.__shift.state.settings).length;assert.strictEqual(n,9);
for(const t of ['horarios','importar','alarmes','historico'])tab(t);
// 6) definições + ics
$('#btnSettings').click();assert($('#bIcs'));$('.sheet [data-close]').click();
console.log('UI OK');
