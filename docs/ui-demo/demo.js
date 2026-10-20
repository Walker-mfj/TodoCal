const $=s=>document.querySelector(s);
const tasks=[
{id:1,title:'Weekly planning',day:0,hour:9,duration:1,group:'Work',done:true},
{id:2,title:'Website direction',day:0,hour:10,duration:1.5,group:'Work',done:false},
{id:3,title:'Read one chapter',day:0,hour:13,duration:1,group:'Study',done:false},
{id:4,title:'Book dentist',day:0,hour:null,duration:1,group:'Personal',done:true},
{id:5,title:'Design exploration',day:1,hour:9.5,duration:2,group:'Work',done:false},
{id:6,title:'Japanese practice',day:1,hour:13,duration:1,group:'Study',done:false},
{id:7,title:'Review & refine',day:2,hour:10,duration:1.5,group:'Work',done:false},
{id:8,title:'Send project update',day:2,hour:null,duration:1,group:'Work',done:false},
{id:9,title:'Build the prototype',day:3,hour:9,duration:2,group:'Work',done:false},
{id:10,title:'Team review',day:4,hour:11,duration:1,group:'Work',done:false},
{id:11,title:'Language notes',day:5,hour:10,duration:1,group:'Study',done:false},
{id:12,title:'A walk outside',day:6,hour:11,duration:1.5,group:'Personal',done:false}];
let page='calendar',view='week',selected=2,editing=null,concept='a';
const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=h=>h===null?'No time assigned':`${String(Math.floor(h)).padStart(2,'0')}:${String(Math.round((h%1)*60)).padStart(2,'0')}`;
function event(t,position=true){return `<button class="event ${t.group.toLowerCase()} ${t.done?'done':''}" data-task="${t.id}" ${position?`style="top:${(t.hour-9)*68+3}px;height:${t.duration*68-6}px"`:''}><strong>${t.done?'✓ ':''}${esc(t.title)}</strong>${position?`<small>${time(t.hour)}</small>`:''}</button>`}
function render(){document.body.dataset.page=page;const today=tasks.filter(t=>t.day===0),done=today.filter(t=>t.done).length,p=Math.round(done/today.length*100);$('#summary').textContent=`${done} of ${today.length} tasks complete`;$('#percent').textContent=`${p}%`;$('#progress').style.width=p+'%';$('#breadcrumb').textContent='Workspace / '+page[0].toUpperCase()+page.slice(1);$('#heading').textContent=page==='analytics'?'Progress, in perspective.':page==='tasks'?'Everything on your mind.':concept==='b'?'Make space for a good week.':concept==='c'?'Your week. In focus.':'A week with room to focus.';$('#subtitle').textContent=page==='analytics'?'A look back at your plans and the progress you made.':'Plan the work. See your progress. Find your rhythm.';$('.toolbar').style.display=page==='calendar'?'flex':'none';$('.agenda').style.display=concept==='b'&&page==='calendar'?'block':'none';$('#agenda-list').innerHTML=today.map(t=>`<button class="agenda-item" data-task="${t.id}">${t.done?'✓':'○'} ${esc(t.title)}<small>${time(t.hour)} · ${t.group}</small></button>`).join('');
if(page==='calendar'&&view==='week'){$('#canvas').innerHTML=`<div class="week-head"><div></div>${days.map((d,i)=>`<div class="day ${i===0?'today':''}"><small>${d.toUpperCase()}</small><strong>${19+i}</strong><em>${i===0?p+'% complete':tasks.filter(t=>t.day===i).length+' planned'}</em></div>`).join('')}</div><div class="untimed"><small>No time<br>assigned</small>${days.map((_,i)=>`<div>${tasks.filter(t=>t.day===i&&t.hour===null).map(t=>event(t,false)).join('')}</div>`).join('')}</div><div class="timeline"><div class="hours">${[9,10,11,12,13,14].map(h=>`<span>${h}:00</span>`).join('')}</div>${days.map((_,i)=>`<div class="day-column ${i===0?'today':''}" data-day="${i}">${tasks.filter(t=>t.day===i&&t.hour!==null).map(t=>event(t)).join('')}</div>`).join('')}</div>`}
else if(page==='calendar'){$('#canvas').innerHTML=`<div class="month-grid">${days.map(d=>`<div class="month-label">${d}</div>`).join('')}${Array.from({length:35},(_,i)=>{let n=i-2;return `<div class="month-cell ${n===19?'today':''}">${n>0&&n<=31?`<strong>${n}</strong>${tasks.filter(t=>plusDays(demoToday,t.day)==='2026-10-'+String(n).padStart(2,'0')).slice(0,2).map(t=>event(t,false)).join('')}${tasks.filter(t=>plusDays(demoToday,t.day)==='2026-10-'+String(n).padStart(2,'0')).length>2?'<small>+2 tasks</small>':''}`:''}</div>`}).join('')}</div>`}
else if(page==='tasks'){$('#canvas').innerHTML=tasks.map(t=>`<div class="list-row"><button data-task="${t.id}">${t.done?'✓':'○'} ${esc(t.title)}<small>${t.group} · ${dateLabel(plusDays(demoToday,t.day))} · ${time(t.hour)}</small></button><span class="muted">${t.done?'Complete':'Planned'}</span></div>`).join('')}
else{$('#canvas').innerHTML=renderAnalytics()}
renderDetails();}
function renderDetails(){let t=tasks.find(t=>t.id===selected);$('#task-title').textContent=t.title;$('#task-group').textContent=t.group;$('.task-group').textContent=t.group.toUpperCase();$('#task-time').textContent=t.hour===null?'No time assigned':time(t.hour)+' – '+time(t.hour+t.duration);$('.detail-row strong').textContent=`${days[t.day]}, ${dateLabel(plusDays(demoToday,t.day))}`;$('.detail-description').textContent=t.id===2?'Explore the layout and prepare a clear direction for the next design review.':'Make time for this task in your weekly plan.';$('#complete').textContent=t.done?'Reopen task':t.day>0?'Move to today & complete':'Mark complete';}
function notify(s){$('#toast').textContent=s;$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,2800)}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.concept){concept=b.dataset.concept;document.body.dataset.theme=concept;$('.workspace').classList.remove('detail-closed');$('#details').classList.remove('open');document.querySelectorAll('[data-concept]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));$('#design-caption').textContent={a:'A / Clear Week — a spacious calendar with details one click away.',b:'B / Quiet Planner — a warm daily agenda beside your weekly plan.',c:'C / Focus Desk — a compact workspace for information at a glance.'}[concept];render()}if(b.dataset.page){page=b.dataset.page;document.querySelectorAll('[data-page]').forEach(x=>x.classList.toggle('selected',x===b));render()}if(b.dataset.view){view=b.dataset.view;document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('selected',x===b));render()}if(b.dataset.task){selected=+b.dataset.task;$('.workspace').classList.remove('detail-closed');$('#details').classList.add('open');renderDetails()}});
$('#complete').onclick=()=>{let t=tasks.find(t=>t.id===selected);if(t.day>0)t.day=0;t.done=!t.done;render();notify(t.done?'Task completed. Daily progress updated.':'Task reopened.')};$('#close').onclick=()=>{if(concept==='b')$('#details').classList.remove('open');else $('.workspace').classList.add('detail-closed')};$('#today').onclick=()=>{page='calendar';view='week';document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view==='week'));render()};
function recurrenceStep(){return $('#repeat-input').value==='weekly'?7:$('#repeat-input').value==='interval'?Number($('#interval-input').value):1}
function updateRepeat(){
 const mode=$('#repeat-input').value,start=$('#date-input').value,end=$('#end-date-input').value;
 $('#repeat-options').hidden=mode==='none'||!!editing;$('#interval-field').hidden=mode!=='interval';$('#interval-input').disabled=mode!=='interval'||!!editing;$('#end-date-input').disabled=mode==='none'||!!editing;$('#end-date-input').min=start;
 if(!start)return;
 const step=recurrenceStep(),weekday=dateLabel(start,{weekday:'long'});
 const rule=mode==='weekly'?`Every ${weekday}`:mode==='interval'?`Every ${step} days`:'Every day';
 $('#repeat-summary').textContent=`${rule}, starting ${dateLabel(start)}${end?` through ${dateLabel(end)} (inclusive).`:' with no end date. Preview shows the next 28 days.'}`;
 $('#end-date-input').setCustomValidity(end&&end<start?'End date must be on or after the start date.':'');
}
function openForm(id=null){
 editing=id;let t=tasks.find(t=>t.id===id);$('#form-heading').textContent=t?'Edit task':'New task';$('#title-input').value=t?.title||'';$('#date-input').value=plusDays(demoToday,t?.day||0);$('#group-input').value=t?.group||'Work';$('#time-input').value=t&&t.hour!==null?time(t.hour):'';
 $('#repeat-input').value='none';$('#repeat-input').disabled=!!editing;$('#end-date-input').value='';$('#interval-input').value=2;$('#edit-repeat-note').hidden=!t?.seriesId;updateRepeat();$('#editor').showModal();
}
$('#add').onclick=()=>openForm();$('#edit').onclick=()=>openForm(selected);$('#cancel').onclick=()=>$('#editor').close();
['#repeat-input','#interval-input','#date-input','#end-date-input'].forEach(sel=>$(sel).addEventListener('input',updateRepeat));
$('#task-form').onsubmit=e=>{
 e.preventDefault();let title=$('#title-input').value.trim();if(!title){$('#title-input').setCustomValidity('Enter a task title.');$('#title-input').reportValidity();return}
 const start=$('#date-input').value,mode=$('#repeat-input').value,end=$('#end-date-input').value,h=$('#time-input').value;
 const item={title,day:Math.round((dateObj(start)-dateObj(demoToday))/86400000),hour:h?Number(h.split(':')[0])+Number(h.split(':')[1])/60:null,group:$('#group-input').value};
 if(item.hour!==null&&(item.hour<9||item.hour>14)){notify('This preview shows 09:00–15:00. Choose a time in that range.');return}
 let count=1;
 if(editing)Object.assign(tasks.find(t=>t.id===editing),item);
 else if(mode==='none')tasks.push({...item,id:Date.now(),duration:.5,done:false});
 else{
 const step=recurrenceStep(),last=end||plusDays(start,27);if(!Number.isInteger(step)||step<1||last<start)return;
 count=Math.floor((dateObj(last)-dateObj(start))/86400000/step)+1;
 if(count>366){notify('This preview supports up to 366 occurrences. Choose an earlier end date.');return}
 const base=Date.now(),seriesId='series-'+base;
 for(let i=0;i<count;i++)tasks.push({...item,id:base+i,day:item.day+i*step,duration:.5,done:false,seriesId,recurrence:mode,intervalDays:step,repeatUntil:end||null});
 }
 $('#editor').close();render();notify(count>1?`${count} separate occurrences added to this preview.`:'Task saved in this preview.');
};
$('#title-input').oninput=()=>$('#title-input').setCustomValidity('');$('#focus').onclick=()=>{$('#focus-status').textContent='25:00 · Preview only — no real timer is running.';notify('Optional focus-session placement preview.')};render();
