const fs=require('fs'),{PNG}=require('pngjs'),assert=require('assert');
const Core=require('../core.js');
const png=PNG.sync.read(fs.readFileSync(__dirname+'/synth.png'));
const meta=JSON.parse(fs.readFileSync(__dirname+'/synth.json'));
const img={width:png.width,height:png.height,data:png.data};
const r=Core.analyse(img,meta.words,meta.text,Core.DEFAULT_REFS,new Date(2026,10,19));
assert(r.ok,r.warnings.join());
assert.strictEqual(r.month,11);assert.strictEqual(r.year,2026);
let bad=0,swapBad=0;
for(const d in meta.truth){const t=meta.truth[d],g=r.days[d];
 if(g.type!==t.type){bad++;console.log('tipo',d,t.type,g.type,g.dist)}
 if(g.swap!==t.swap){swapBad++;console.log('troca',d,t.swap,g.swap,g.dashScore)}}
for(const d of meta.dropped) assert(r.days[d].doubt,'dia sem OCR deve ficar em dúvida '+d);
console.log('tipos errados',bad,'trocas erradas',swapBad,'grid',JSON.stringify(r.grid));
assert.strictEqual(bad,0);assert.strictEqual(swapBad,0);
// diff
const S={start:'11:00',end:'15:00'};
const inc={};for(const d in r.days){const x=r.days[d];if(x.type==='none'||+d>30)continue;inc[`2026-11-${Core.pad(d)}`]=Core.mkIncoming(x,S)}
const ex={};
let diff=Core.diffMonth(ex,inc);assert.strictEqual(diff.length,Object.keys(inc).length);
diff.forEach(c=>Core.applyChange(ex,c,'i1'));
assert.strictEqual(Core.diffMonth(ex,inc).length,0,'reimportar igual = sem diferenças');
ex['2026-11-03'].manual=true;ex['2026-11-03'].start='14:00';ex['2026-11-03'].end='18:00';
const k=Object.keys(inc).find(x=>inc[x].type==='work'&&x!=='2026-11-03');
inc['2026-11-03']=Core.mkIncoming({type:'work'},S);
diff=Core.diffMonth(ex,inc);
const c3=diff.find(c=>c.date==='2026-11-03');
if(inc['2026-11-03'].type==='work'&&ex['2026-11-03'].type==='work')assert(c3&&c3.manualConflict,'conflito manual');
// alarmes
const set={autoAlarms:true,alarms:{forStart:'11:00',first:'07:20',last:'08:00',step:5}};
const seq=Core.sequence(set.alarms);assert.strictEqual(seq.length,9);assert.strictEqual(seq[0],'07:20');assert.strictEqual(seq[8],'08:00');
assert.strictEqual(Core.activeAlarmTimes({type:'work',start:'11:00'},set).length,9);
assert.strictEqual(Core.activeAlarmTimes({type:'work',start:'14:00'},set).length,0);
assert.strictEqual(Core.activeAlarmTimes({type:'off_mand'},set).length,0);
assert.strictEqual(Core.activeAlarmTimes({type:'work',start:'14:00',alarmCustom:['11:30']},set)[0],'11:30');
// ics
const ics=Core.buildICS({'2026-11-04':{type:'work',start:'11:00',end:'15:00'},'2026-11-05':{type:'off_mand'},'2026-11-06':{type:'work',start:'14:00',end:'18:00',swap:true,orig:'off'}},3,new Date(Date.UTC(2026,10,19)));
assert((ics.match(/BEGIN:VEVENT/g)||[]).length===2);assert(ics.includes('UID:shift-2026-11-04@shift.local'));assert(ics.includes('DTSTART:20261106T140000'));
assert(ics.includes('\r\n'));console.log('OK');
