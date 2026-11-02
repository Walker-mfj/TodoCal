import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function setup(){
 const events={};const shown=[];const opened=[];
 const self={location:{origin:'https://app.example.com'},addEventListener:(name,fn)=>events[name]=fn,skipWaiting:async()=>{},registration:{showNotification:async(...args)=>shown.push(args)},clients:{claim:async()=>{},matchAll:async()=>[],openWindow:async url=>opened.push(url)}};
 vm.runInNewContext(readFileSync(new URL('../../apps/web/public/sw.js',import.meta.url),'utf8'),{self,URL});
 return {events,shown,opened};
}
test('push displays generic payload with stable dedupe tag and safe click URL',async()=>{
 const {events,shown,opened}=setup();let work;
 events.push({data:{json:()=>({body:'Your focus session is complete.',tag:'todocal-123',url:'/?notification=focus'})},waitUntil:p=>work=p});await work;
 assert.equal(shown[0][0],'TodoCal');assert.equal(shown[0][1].tag,'todocal-123');
 events.notificationclick({notification:{data:shown[0][1].data,close(){}},waitUntil:p=>work=p});await work;
 assert.equal(opened[0],'https://app.example.com/?notification=focus');
});
test('malformed payload and external click cannot open another origin',async()=>{
 const {events,shown,opened}=setup();let work;
 events.push({data:{json:()=>{throw Error('invalid')}},waitUntil:p=>work=p});await work;
 assert.equal(shown.length,1);
 events.notificationclick({notification:{data:{url:'https://evil.test/'},close(){}},waitUntil:p=>work=p});await work;
 assert.equal(opened[0],'https://app.example.com/');
});
