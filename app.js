const DAY = 86400000;
const today = new Date();
const isoDate = d => {const date=new Date(d);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`};
const addDays = n => isoDate(new Date(today.getTime() + n * DAY));
const uid = prefix => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const dateOnly = value => String(value ?? "").slice(0, 10);

const MEMBER_MODES = ["기간제","상시"];
const CHILD_STATUS = ["사용 가능","사용 중","사용 예정","사용 중지","보관"];
const ROOT_STATUS = ["운영 중","종료 예정","종료","보관"];
const COURSE_STATUS = ["예정","확정","진행","완료","취소"];

const demoData = {
  roots: [
    {id:"r1",name:"AI 교육 1팀",email:"owner-a@example.com",billingDay:12,expiry:addDays(18),capacity:25,status:"운영 중",memo:""},
    {id:"r2",name:"AI 교육 2팀",email:"owner-b@example.com",billingDay:25,expiry:addDays(71),capacity:18,status:"운영 중",memo:""},
    {id:"r3",name:"실습 예비 워크스페이스",email:"owner-c@example.com",billingDay:3,expiry:addDays(9),capacity:12,status:"종료 예정",memo:"갱신 여부 확인"}
  ],
  children: [
    {id:"c1",rootId:"r1",name:"교육 운영 01",email:"member01@example.com",status:"사용 중"},{id:"c2",rootId:"r1",name:"교육 운영 02",email:"member02@example.com",status:"사용 가능"},{id:"c3",rootId:"r1",name:"교육 운영 03",email:"member03@example.com",status:"사용 중"},{id:"c4",rootId:"r2",name:"실습 계정 01",email:"lab01@example.com",status:"사용 가능"},{id:"c5",rootId:"r2",name:"실습 계정 02",email:"lab02@example.com",status:"사용 중"},{id:"c6",rootId:"r3",name:"예비 계정 01",email:"reserve01@example.com",status:"사용 가능"}
  ],
  guests: [
    {id:"g1",name:"김민서",email:"minseo@example.com",organization:"ABC 교육원",rootId:"r1",courseId:"co1",start:addDays(-2),end:addDays(3),removedAt:"",memo:""},
    {id:"g2",name:"박준호",email:"junho@example.com",organization:"XYZ 연구소",rootId:"r2",courseId:"co2",start:addDays(-8),end:addDays(-1),removedAt:"",memo:"제거 확인 필요"},
    {id:"g3",name:"이서윤",email:"seoyun@example.com",organization:"개인",rootId:"r1",courseId:"co3",start:addDays(6),end:addDays(8),removedAt:"",memo:""}
  ],
  courses: [
    {id:"co1",title:"생성형 AI 실무 과정",start:`${addDays(2)}T10:00`,end:`${addDays(2)}T17:00`,required:20,assigned:0,memberMode:"기간제",rootId:"r1",manager:"정우진",status:"확정",memo:""},
    {id:"co2",title:"GPT 업무자동화 워크숍",start:`${addDays(6)}T09:30`,end:`${addDays(6)}T16:00`,required:4,assigned:0,memberMode:"상시",rootId:"",manager:"한유리",status:"확정",memo:""},
    {id:"co3",title:"프롬프트 디자인 기초",start:`${addDays(8)}T13:00`,end:`${addDays(8)}T18:00`,required:24,assigned:0,memberMode:"기간제",rootId:"",manager:"강지훈",status:"예정",memo:"추가 좌석 검토"}
  ],
  settings:{ownerUsesSeat:true}
};

let state = loadLocal();
let currentView = "dashboard";
let calendarDate = new Date(today.getFullYear(), today.getMonth(), 1);
let editing = null;
let plans = new Map();

function loadLocal(){try{return JSON.parse(localStorage.getItem("gpt-account-manager-data")) || structuredClone(demoData)}catch{return structuredClone(demoData)}}
function apiUrl(){return localStorage.getItem("gpt-account-manager-api") || window.APP_CONFIG?.appsScriptUrl || ""}
function rootName(id){return state.roots.find(r=>r.id===id)?.name || "미지정"}
function courseTitle(id){return state.courses.find(c=>c.id===id)?.title || ""}
function guestStatus(g){if(g.removedAt)return "제거 완료";const d=isoDate(today);if(g.end<d)return "제거 필요";if(g.start>d)return "초대 예정";return "이용 중"}
function statusClass(s){return ["제거 필요","종료","취소"].includes(s)?"danger":["종료 예정","초대 예정","예정","사용 중지"].includes(s)?"warn":["제거 완료","완료","보관"].includes(s)?"neutral":""}
function fmtDate(d){return new Intl.DateTimeFormat("ko-KR",{month:"short",day:"numeric",weekday:"short"}).format(new Date(d))}
function fmtDateTime(d){return new Intl.DateTimeFormat("ko-KR",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(d))}
function showToast(message){const el=document.querySelector("#toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2200)}

// ---- 좌석 계산 -------------------------------------------------------------
// 상시 멤버는 워크스페이스 좌석을 늘 점유하고, 기간제 멤버는 초대 기간에만 점유한다.
// 그래서 여유 좌석은 "오늘"이 아니라 "언제 기준인지"에 따라 달라진다.
const isActiveRoot = r => r.status==="운영 중" || r.status==="종료 예정";
const isUsableChild = c => c.status!=="보관" && c.status!=="사용 중지";
const isPlannedCourse = c => c.status!=="취소" && c.status!=="완료";

// 워크스페이스 소유자도 실제로 쓸 수 있는 상시 계정이다. 다만 좌석을 차지하지 않는
// 설정이면 그 워크스페이스에 자리가 없다는 뜻이므로 배정 대상에서 뺀다.
function ownerAccount(root){return {id:`owner:${root.id}`,rootId:root.id,name:`${root.name} 소유자`,email:root.email,status:"소유자",owner:true}}
function ownerIsMember(root){return !!state.settings.ownerUsesSeat && isActiveRoot(root)}
// 전용 상시 계정을 먼저 쓰고 관리자 계정인 소유자는 마지막에 쓰도록 뒤에 붙인다.
function permanentAccounts(root){
  const list = state.children.filter(c=>c.rootId===root.id && isUsableChild(c));
  return ownerIsMember(root) ? [...list, ownerAccount(root)] : list;
}

function activeGuests(rootId, date=isoDate(today)){return state.guests.filter(g=>g.rootId===rootId&&!g.removedAt&&g.start<=date&&g.end>=date).length}
function seatsUsedOn(root, date=isoDate(today)){
  return state.children.filter(c=>c.rootId===root.id&&isUsableChild(c)).length
    + activeGuests(root.id, date)
    + (state.settings.ownerUsesSeat?1:0);
}
function freeSeatsOn(root, date=isoDate(today)){return Math.max(0, Number(root.capacity||0) - seatsUsedOn(root, date))}
function usedSeats(root){return seatsUsedOn(root)}
function freeSeats(root){return freeSeatsOn(root)}

// ---- 자동 배정 엔진 ---------------------------------------------------------
// 강의 시간이 겹치면 같은 상시 계정을 두 강의에 쓸 수 없다.
function coursesOverlap(a, b){
  const aEnd = String(a.end || a.start), bEnd = String(b.end || b.start);
  return String(a.start) < bEnd && String(b.start) < aEnd;
}
// 기간제 초대는 하루 단위라 좌석 충돌은 날짜 범위로 본다.
function courseDaysOverlap(a, b){
  const aS = dateOnly(a.start), aE = dateOnly(a.end) || aS;
  const bS = dateOnly(b.start), bE = dateOnly(b.end) || bS;
  return aS <= bE && bS <= aE;
}

// 단일 워크스페이스로 충당되면 그쪽에 몰아준다. 여러 곳이 가능하면 가장 빠듯한 곳을
// 골라 큰 워크스페이스를 뒤 강의용으로 남긴다. 아무 곳도 혼자 감당 못 하면 분산한다.
function pickOrder(pools, need, sizeOf, preferredId){
  const preferred = pools.find(p=>p.root.id===preferredId);
  if(preferred && sizeOf(preferred)>=need) return [preferred];
  const single = pools.filter(p=>sizeOf(p)>=need).sort((a,b)=>sizeOf(a)-sizeOf(b))[0];
  if(single) return [single];
  const rest = pools.filter(p=>p!==preferred).sort((a,b)=>sizeOf(b)-sizeOf(a));
  return preferred ? [preferred, ...rest] : rest;
}

function planPermanent(course, roots, need, takenAccounts){
  const blocked = new Set(takenAccounts.filter(t=>coursesOverlap(t.course, course)).map(t=>t.childId));
  const pools = roots
    .map(root=>({root, accounts: permanentAccounts(root).filter(c=>!blocked.has(c.id))}))
    .filter(p=>p.accounts.length);
  const groups=[]; let left=need;
  pickOrder(pools, need, p=>p.accounts.length, course.rootId).forEach(p=>{
    if(left<=0) return;
    const take = p.accounts.slice(0, Math.min(left, p.accounts.length));
    take.forEach(c=>takenAccounts.push({childId:c.id, course}));
    groups.push({rootId:p.root.id, seats:take.length, accounts:take.map(c=>({id:c.id,name:c.name,email:c.email,owner:!!c.owner}))});
    left -= take.length;
  });
  return {mode:"상시", need, filled:need-left, shortage:left, groups};
}

function planGuest(course, roots, need, takenSeats){
  const from = dateOnly(course.start), to = dateOnly(course.end) || from;
  const pools = roots.map(root=>{
    const reserved = takenSeats.filter(t=>t.rootId===root.id && courseDaysOverlap(t.course, course)).reduce((a,t)=>a+t.seats, 0);
    const free = Math.min(freeSeatsOn(root, from), freeSeatsOn(root, to)) - reserved;
    return {root, free: Math.max(0, free)};
  }).filter(p=>p.free>0);
  const groups=[]; let left=need;
  pickOrder(pools, need, p=>p.free, course.rootId).forEach(p=>{
    if(left<=0) return;
    const seats = Math.min(left, p.free);
    takenSeats.push({rootId:p.root.id, course, seats});
    groups.push({rootId:p.root.id, seats});
    left -= seats;
  });
  return {mode:"기간제", need, filled:need-left, shortage:left, groups};
}

// 강의를 시작 순서대로 처리하며 좌석과 계정을 소진시킨다. 먼저 잡힌 강의가 우선권을 갖는다.
function planAllocations(){
  const roots = state.roots.filter(isActiveRoot);
  const takenSeats = [], takenAccounts = [], result = new Map();
  state.courses
    .filter(c=>isPlannedCourse(c) && dateOnly(c.start) >= isoDate(today))
    .sort((a,b)=>String(a.start).localeCompare(String(b.start)) || String(a.id).localeCompare(String(b.id)))
    .forEach(course=>{
      const need = Math.max(0, Number(course.required) || 0);
      const plan = course.memberMode==="상시"
        ? planPermanent(course, roots, need, takenAccounts)
        : planGuest(course, roots, need, takenSeats);
      course.assigned = plan.filled;
      result.set(course.id, plan);
    });
  return result;
}

function planOf(course){
  return plans.get(course.id) || {mode:course.memberMode||"기간제", need:Number(course.required)||0, filled:Number(course.assigned)||0, shortage:0, groups:[]};
}
function courseLevel(c){const p=plans.get(c.id);if(!p)return "ok";return p.shortage<=0?"ok":p.filled>0?"warn":"danger"}
// days를 생략하면 기간 제한 없이 다가오는 강의를 전부 돌려준다.
function upcomingCourses(days){
  const limit = days==null ? null : addDays(days);
  return state.courses
    .filter(c=>isPlannedCourse(c) && dateOnly(c.start) >= isoDate(today) && (!limit || dateOnly(c.start) <= limit))
    .sort((a,b)=>String(a.start).localeCompare(String(b.start)));
}

// ---- 저장 ------------------------------------------------------------------
async function loadRemote(){if(!apiUrl())return renderAll();setSync("loading","데이터 불러오는 중");try{const res=await fetch(`${apiUrl()}?action=all&t=${Date.now()}`);if(!res.ok)throw new Error();const json=await res.json();if(json.ok===false)throw new Error(json.error);state=json.data;normalize();localStorage.setItem("gpt-account-manager-data",JSON.stringify(state));setSync("connected","Google Sheets 연결됨");renderAll()}catch(e){setSync("error","연결 오류 · 로컬 데이터");showToast("Sheets 연결에 실패해 로컬 데이터를 표시합니다.");renderAll()}}
async function persist(){normalize();renderAll();localStorage.setItem("gpt-account-manager-data",JSON.stringify(state));if(!apiUrl())return;setSync("loading","저장 중");try{const res=await fetch(apiUrl(),{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"saveAll",data:state})});const json=await res.json();if(json.ok===false)throw new Error(json.error);setSync("connected","Google Sheets 연결됨");showToast("Google Sheets에 저장했습니다.")}catch(e){setSync("error","동기화 실패 · 로컬 저장됨");showToast("로컬에는 저장했지만 Sheets 동기화에 실패했습니다.")}}
function normalize(){
  state.roots ||= [];state.children ||= [];state.guests ||= [];state.courses ||= [];state.settings ||= {ownerUsesSeat:true};
  state.courses.forEach(c=>{if(!MEMBER_MODES.includes(c.memberMode))c.memberMode="기간제"});
}
function setSync(type,label){document.querySelector("#syncLabel").textContent=label;document.querySelector("#syncDot").className=`sync-dot ${type==="connected"?"connected":""}`}

// ---- 렌더 ------------------------------------------------------------------
function renderAll(){normalize();plans=planAllocations();renderDashboard();renderAccounts();renderGuests();renderCalendar();renderSettings()}

function renderDashboard(){
  const activeRoots=state.roots.filter(isActiveRoot);
  const totalCapacity=activeRoots.reduce((a,r)=>a+Number(r.capacity),0), used=activeRoots.reduce((a,r)=>a+usedSeats(r),0);
  const activeGuestCount=state.guests.filter(g=>guestStatus(g)==="이용 중").length;
  const horizon=upcomingCourses(30).map(c=>planOf(c));
  const maxShortage=Math.max(0,...horizon.map(p=>p.shortage));
  const shortCourses=horizon.filter(p=>p.shortage>0).length;
  document.querySelector("#heroShortage").textContent=maxShortage;
  document.querySelector("#heroNote").textContent=shortCourses?`${shortCourses}개 강의가 좌석을 다 채우지 못했습니다.`:"향후 30일 강의는 모두 배정 가능합니다.";
  const cards=[['워크스페이스',activeRoots.length,'운영 중','▦'],['전체 좌석',totalCapacity,`${used}석 사용 중`,'◫'],['여유 좌석',Math.max(0,totalCapacity-used),'오늘 기준','↗'],['이용 중 게스트',activeGuestCount,'기간제 멤버','♙']];
  document.querySelector("#metrics").innerHTML=cards.map(x=>`<article class="metric"><div class="metric-head"><span>${x[0]}</span><i class="metric-icon">${x[3]}</i></div><strong>${x[1]}</strong><small>${x[2]}</small></article>`).join("");
  document.querySelector("#capacityList").innerHTML=activeRoots.map(r=>{const u=usedSeats(r),cap=Math.max(1,Number(r.capacity)),pct=Math.min(100,Math.round(u/cap*100));return `<div class="capacity-row"><div class="capacity-name"><b>${escapeHtml(r.name)}</b><small>${escapeHtml(r.email)}</small></div><div class="bar"><i class="${pct>=85?'high':''}" style="width:${pct}%"></i></div><div class="capacity-num"><b>${u}</b> / ${r.capacity}</div></div>`}).join("")||`<div class="empty">등록된 워크스페이스가 없습니다.</div>`;

  const actions=[];
  state.guests.filter(g=>guestStatus(g)==="제거 필요").forEach(g=>actions.push({danger:true,title:`${g.name} 제거 필요`,sub:`${rootName(g.rootId)} · ${g.end} 종료`}));
  state.roots.filter(r=>r.status!=="종료"&&(new Date(r.expiry)-today)/DAY<=30).forEach(r=>actions.push({danger:false,title:`${r.name} 만료 임박`,sub:`${r.expiry} · ${Math.max(0,Math.ceil((new Date(r.expiry)-today)/DAY))}일 남음`}));
  upcomingCourses(30).forEach(c=>{const p=planOf(c);if(p.shortage>0)actions.push({danger:true,title:`${c.title} ${p.shortage}${p.mode==="상시"?"개 계정":"석"} 부족`,sub:`${fmtDateTime(c.start)} · ${p.mode} 배정`})});
  document.querySelector("#actionCount").textContent=actions.length;
  document.querySelector("#actionList").innerHTML=actions.slice(0,6).map(a=>`<div class="action-item ${a.danger?'danger':''}"><i></i><div><b>${escapeHtml(a.title)}</b><small>${escapeHtml(a.sub)}</small></div></div>`).join("")||`<div class="empty">지금 처리할 일이 없습니다.</div>`;

  renderAllocations();
}

const ALLOCATION_PREVIEW = 5;
function renderAllocations(){
  const all=upcomingCourses(), list=all.slice(0,ALLOCATION_PREVIEW), rest=all.length-list.length;
  document.querySelector("#allocationMore").textContent=rest>0?`이 외 ${rest}개 강의는 캘린더에서 확인하세요.`:"";
  document.querySelector("#allocationList").innerHTML=list.map(c=>{
    const p=planOf(c), permanent=p.mode==="상시", unit=permanent?"개":"석";
    const registered=state.guests.filter(g=>g.courseId===c.id&&!g.removedAt).length;
    const targets=p.groups.length?p.groups.map(g=>{
      const accounts=g.accounts?.length
        ? `<div class="account-chips">${g.accounts.slice(0,5).map(a=>`<code class="${a.owner?"owner":""}" title="${escapeHtml(a.name)}">${escapeHtml(a.email)}${a.owner?" · 소유자":""}</code>`).join("")}${g.accounts.length>5?`<span class="more">외 ${g.accounts.length-5}개</span>`:""}</div>`
        : `<div class="alloc-hint">이 워크스페이스에 ${g.seats}명을 초대하세요.</div>`;
      return `<div class="alloc-target"><div class="alloc-target-head"><b>${escapeHtml(rootName(g.rootId))}</b><span class="seat-count">${g.seats}${unit}</span></div>${accounts}</div>`;
    }).join(""):`<div class="alloc-target empty-target">배정 가능한 ${permanent?"상시 계정":"좌석"}이 없습니다.</div>`;
    const badge=p.shortage>0
      ? `<span class="status danger">${p.shortage}${unit} 부족</span>`
      : `<span class="status">배정 완료</span>`;
    const progress=permanent?"":`<small class="alloc-progress">실제 초대 등록 ${registered} / ${p.need}명</small>`;
    return `<article class="alloc-item ${p.shortage>0?'short':''}">
      <div class="alloc-when"><b>${fmtDate(c.start)}</b><small>${String(c.start).slice(11,16)}</small></div>
      <div class="alloc-main">
        <div class="alloc-title"><b>${escapeHtml(c.title)}</b><span class="mode-tag ${permanent?'permanent':'guest'}">${p.mode} 멤버</span></div>
        <small>${escapeHtml(c.manager||"담당자 미정")} · ${p.need}${unit} 필요 · ${p.filled}${unit} 배정</small>
        ${progress}
      </div>
      <div class="alloc-targets">${targets}</div>
      <div class="alloc-side">${badge}<button class="mini-button" data-edit-course="${c.id}">수정</button></div>
    </article>`;
  }).join("")||`<div class="empty">예정된 강의가 없습니다.</div>`;
}

function renderAccounts(){
  const q=document.querySelector("#accountSearch").value.toLowerCase(),f=document.querySelector("#accountFilter").value;
  const rows=state.roots.filter(r=>(f==="all"||r.status===f)&&[r.name,r.email,...state.children.filter(c=>c.rootId===r.id).flatMap(c=>[c.name,c.email])].join(' ').toLowerCase().includes(q));
  document.querySelector("#workspaceGrid").innerHTML=rows.map(r=>{
    const children=state.children.filter(c=>c.rootId===r.id&&c.status!=="보관");
    // 소유자 계정은 워크스페이스 수정 화면에서 다루므로 목록에서는 읽기 전용으로 보여준다.
    const ownerRow=ownerIsMember(r)?`<div class="member"><span class="avatar">◆</span><div><b>${escapeHtml(r.name)} 소유자</b><small>${escapeHtml(r.email)}</small></div><span class="status neutral">소유자</span></div>`:'';
    const memberRows=ownerRow+children.map(c=>`<div class="member"><span class="avatar">${escapeHtml(c.name.slice(-2))}</span><div><b>${escapeHtml(c.name)}</b><small>${escapeHtml(c.email)}</small></div><span class="status ${statusClass(c.status)}">${c.status}</span><button class="mini-button" data-edit-child="${c.id}">수정</button></div>`).join('');
    return `<article class="workspace-card ${r.status==='종료'?'archived':''}"><div class="workspace-head"><div class="workspace-symbol">${escapeHtml(r.name.slice(0,1))}</div><div><h3>${escapeHtml(r.name)}</h3><p>${escapeHtml(r.email)}</p></div><span class="status ${statusClass(r.status)}">${r.status}</span></div><div class="workspace-stats"><div><small>총 좌석</small><b>${r.capacity}</b></div><div><small>사용</small><b>${usedSeats(r)}</b></div><div><small>여유</small><b>${freeSeats(r)}</b></div></div><div class="member-list">${memberRows||'<div class="empty">상시 멤버가 없습니다.</div>'}</div><div class="workspace-actions"><button class="mini-button" data-add-child="${r.id}">+ 상시 멤버</button><button class="mini-button" data-edit-root="${r.id}">워크스페이스 수정</button></div></article>`;
  }).join('')||'<div class="empty">검색 결과가 없습니다.</div>';
}

function renderGuests(){
  const q=document.querySelector("#guestSearch").value.toLowerCase(),f=document.querySelector("#guestFilter").value;
  const rows=state.guests.filter(g=>(f==='all'||guestStatus(g)===f)&&[g.name,g.email,g.organization].join(' ').toLowerCase().includes(q));
  document.querySelector("#guestTable").innerHTML=rows.map(g=>`<tr><td><b>${escapeHtml(g.name)}</b><small>${escapeHtml(g.email)}</small></td><td>${escapeHtml(g.organization||'-')}</td><td>${escapeHtml(rootName(g.rootId))}<small>${escapeHtml(courseTitle(g.courseId)||'강의 미지정')}</small></td><td>${g.start} → ${g.end}</td><td><span class="status ${statusClass(guestStatus(g))}">${guestStatus(g)}</span></td><td><div class="row-actions">${guestStatus(g)==='제거 필요'?`<button class="mini-button" data-remove-guest="${g.id}">제거 완료</button>`:''}<button class="mini-button" data-edit-guest="${g.id}">수정</button></div></td></tr>`).join('')||'<tr><td colspan="6" class="empty">등록된 기간제 멤버가 없습니다.</td></tr>';
}

function renderCalendar(){
  const y=calendarDate.getFullYear(),m=calendarDate.getMonth();
  document.querySelector("#monthLabel").textContent=`${y}년 ${m+1}월`;
  const first=new Date(y,m,1),startDay=1-first.getDay();
  let html='';
  for(let i=0;i<42;i++){
    const d=new Date(y,m,startDay+i),key=isoDate(d),events=state.courses.filter(c=>dateOnly(c.start)===key);
    html+=`<div class="day ${d.getMonth()!==m?'muted':''} ${key===isoDate(today)?'today':''}"><span class="day-number">${d.getDate()}</span>${events.map(c=>`<button class="course-chip ${courseLevel(c)}" data-edit-course="${c.id}" title="${escapeHtml(c.title)} · ${c.memberMode} 멤버"><b>${escapeHtml(c.title)}</b>${String(c.start).slice(11,16)} · ${c.memberMode[0]} ${planOf(c).filled}/${c.required}</button>`).join('')}</div>`;
  }
  document.querySelector("#calendar").innerHTML=html;
}

function renderSettings(){document.querySelector("#apiUrlInput").value=apiUrl();document.querySelector("#ownerSeatToggle").checked=!!state.settings.ownerUsesSeat;document.querySelector("#connectionHint").textContent=apiUrl()?"URL이 저장되어 있습니다. 새로고침 시 Sheets 데이터를 불러옵니다.":"현재 예시 또는 브라우저 저장 데이터를 사용 중입니다."}

// ---- CSV 일괄 등록 ----------------------------------------------------------
// 한국어 Windows의 Excel은 "CSV UTF-8"이 아닌 그냥 "CSV"로 저장하면 CP949로 기록한다.
// UTF-8로 먼저 엄격하게 해석하고, 실패하면 CP949로 다시 읽는다. 조용히 깨진 글자가
// 등록되는 것을 막기 위해 fatal 옵션이 반드시 필요하다.
async function readCsvText(file){
  const buffer = await file.arrayBuffer();
  try{ return new TextDecoder("utf-8",{fatal:true}).decode(buffer) }
  catch{ return new TextDecoder("euc-kr").decode(buffer) }
}

function parseCsv(text){
  const rows=[];let row=[],cell='',quoted=false;
  text=String(text).replace(/^﻿/,'');
  for(let i=0;i<text.length;i++){
    const char=text[i],next=text[i+1];
    if(char==='"'&&quoted&&next==='"'){cell+='"';i++;continue}
    if(char==='"'){quoted=!quoted;continue}
    if(char===','&&!quoted){row.push(cell.trim());cell='';continue}
    if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&next==='\n')i++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell='';continue}
    cell+=char;
  }
  row.push(cell.trim());if(row.some(Boolean))rows.push(row);
  if(!rows.length)return [];
  const headers=rows[0].map(h=>h.trim().toLowerCase());
  return rows.slice(1).map((values,index)=>({line:index+2,...Object.fromEntries(headers.map((h,i)=>[h,values[i]??'']))}));
}

function normalizeMemberType(value){const v=String(value).trim().toLowerCase();if(['상시','상시 멤버','child','permanent'].includes(v))return 'child';if(['기간제','기간제 멤버','guest','temporary'].includes(v))return 'guest';return ''}
function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)}
function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(new Date(`${value}T00:00:00`).getTime())}
function importMembers(rows){
  const errors=[],children=[],guests=[];
  // 상시 계정은 워크스페이스마다 따로 존재하므로 중복 검사도 워크스페이스 단위로 한다.
  const seenChildren=new Set(state.children.filter(c=>c.status!=='보관').map(c=>`${c.email.toLowerCase()}|${c.rootId}`));
  const seenGuests=new Set(state.guests.filter(g=>!g.removedAt).map(g=>`${g.email.toLowerCase()}|${g.rootId}|${g.start}|${g.end}`));
  rows.forEach(row=>{
    const type=normalizeMemberType(row.member_type),email=String(row.email||'').trim().toLowerCase(),workspaceEmail=String(row.workspace_email||'').trim().toLowerCase();
    const root=state.roots.find(r=>r.email.toLowerCase()===workspaceEmail&&r.status!=='종료'&&r.status!=='보관');
    if(!type)return errors.push(`${row.line}행: member_type은 상시 또는 기간제여야 합니다.`);
    if(!validEmail(email))return errors.push(`${row.line}행: 이메일 형식을 확인해 주세요.`);
    if(!root)return errors.push(`${row.line}행: 운영 중인 워크스페이스 소유자 이메일을 찾을 수 없습니다.`);
    const name=String(row.name||'').trim()||email.split('@')[0];
    if(type==='child'){
      const key=`${email}|${root.id}`;
      if(seenChildren.has(key))return errors.push(`${row.line}행: 이 워크스페이스에 이미 등록된 상시 멤버입니다.`);
      const status=String(row.status||'').trim()||'사용 가능';
      if(!CHILD_STATUS.includes(status))return errors.push(`${row.line}행: 상시 멤버 상태값이 올바르지 않습니다.`);
      seenChildren.add(key);children.push({id:uid('c'),rootId:root.id,name,email,status,memo:String(row.memo||'').trim()});
      return;
    }
    const start=String(row.start||'').trim(),end=String(row.end||'').trim();
    if(!validDate(start)||!validDate(end))return errors.push(`${row.line}행: 기간제 멤버의 start와 end를 YYYY-MM-DD로 입력해 주세요.`);
    if(end<start)return errors.push(`${row.line}행: 종료일은 시작일보다 빠를 수 없습니다.`);
    const guestKey=`${email}|${root.id}|${start}|${end}`;
    if(seenGuests.has(guestKey))return errors.push(`${row.line}행: 같은 기간에 등록된 기간제 멤버입니다.`);
    seenGuests.add(guestKey);guests.push({id:uid('g'),name,email,organization:String(row.organization||'').trim(),rootId:root.id,courseId:'',start,end,removedAt:'',memo:String(row.memo||'').trim()});
  });
  return {errors,children,guests};
}

// ---- 편집 다이얼로그 --------------------------------------------------------
const field=(name,label,type='text',value='',extra='',full=false)=>`<label class="${full?'full':''}">${label}<${type==='textarea'?'textarea':'input'} name="${name}" ${type!=='textarea'?`type="${type}"`:''} value="${type==='textarea'?'':escapeHtml(value)}" ${extra}>${type==='textarea'?escapeHtml(value):''}</${type==='textarea'?'textarea':'input'}></label>`;
const selectField=(name,label,options,value,full=false)=>`<label class="${full?'full':''}">${label}<select name="${name}">${options.map(o=>`<option ${o===value?'selected':''}>${o}</option>`).join('')}</select></label>`;
const rootSelect=(value,label='소속 워크스페이스',allowEmpty=false)=>`<label>${label}<select name="rootId" ${allowEmpty?'':'required'}>${allowEmpty?`<option value="">자동 배정에 맡김</option>`:''}${state.roots.filter(r=>r.status!=="종료").map(r=>`<option value="${r.id}" ${r.id===value?'selected':''}>${escapeHtml(r.name)}</option>`).join('')}</select></label>`;
const courseSelect=(value)=>`<label>연결 강의<select name="courseId"><option value="">지정 안 함</option>${state.courses.filter(c=>c.status!=='취소').sort((a,b)=>String(b.start).localeCompare(String(a.start))).map(c=>`<option value="${c.id}" ${c.id===value?'selected':''}>${escapeHtml(c.title)} · ${dateOnly(c.start)}</option>`).join('')}</select></label>`;

function openEditor(type,id=null,parentId=null){
  editing={type,id,parentId};
  let item,title,fields;
  if(type==='root'){
    item=state.roots.find(x=>x.id===id)||{};
    title=id?'워크스페이스 수정':'워크스페이스 추가';
    fields=field('name','워크스페이스명','text',item.name,'required')+field('email','소유자 이메일','email',item.email,'required')+field('billingDay','결제 기준일','number',item.billingDay||1,'min="1" max="31" required')+field('expiry','만료일','date',item.expiry||isoDate(today),'required')+field('capacity','총 좌석 수','number',item.capacity||10,'min="1" required')+selectField('status','상태',ROOT_STATUS,item.status||'운영 중')+field('memo','메모','textarea',item.memo,'',true);
  }else if(type==='child'){
    item=state.children.find(x=>x.id===id)||{};
    title=id?'상시 멤버 수정':'상시 멤버 추가';
    fields=rootSelect(item.rootId||parentId)+field('name','멤버명','text',item.name,'required')+field('email','이메일','email',item.email,'required')+selectField('status','상태',CHILD_STATUS,item.status||'사용 가능')+field('memo','메모','textarea',item.memo,'',true);
  }else if(type==='guest'){
    item=state.guests.find(x=>x.id===id)||{};
    title=id?'기간제 멤버 수정':'기간제 멤버 추가';
    fields=field('name','이름','text',item.name,'required')+field('email','이메일','email',item.email,'required')+field('organization','소속','text',item.organization)+rootSelect(item.rootId)+courseSelect(item.courseId)+field('start','초대 시작일','date',item.start||isoDate(today),'required')+field('end','초대 종료일','date',item.end||addDays(1),'required')+field('memo','메모','textarea',item.memo,'',true);
  }else{
    item=state.courses.find(x=>x.id===id)||{};
    title=id?'강의 일정 수정':'강의 일정 추가';
    fields=field('title','강의명','text',item.title,'required')
      +selectField('memberMode','사용할 멤버 종류',MEMBER_MODES,item.memberMode||'기간제')
      +field('start','시작 일시','datetime-local',item.start||`${addDays(1)}T10:00`,'required')
      +field('end','종료 일시','datetime-local',item.end||`${addDays(1)}T17:00`,'required')
      +field('required','필요 좌석','number',item.required??10,'min="1" required')
      +field('manager','담당자','text',item.manager)
      +rootSelect(item.rootId,'우선 배정 워크스페이스 (선택)',true)
      +selectField('status','상태',COURSE_STATUS,item.status||'예정')
      +field('memo','메모','textarea',item.memo,'',true);
  }
  document.querySelector("#dialogTitle").textContent=title;
  document.querySelector("#dialogEyebrow").textContent=id?'EDIT RECORD':'NEW RECORD';
  document.querySelector("#formFields").innerHTML=fields;
  document.querySelector("#deleteRecord").hidden=!id;
  document.querySelector("#editorDialog").showModal();
}

function saveEditor(form){
  const v=Object.fromEntries(new FormData(form));
  const replace=(list,item)=>{const found=list.find(x=>x.id===editing.id);found?Object.assign(found,item):list.push(item)};
  if(editing.type==='root'){
    replace(state.roots,{id:editing.id||uid('r'),name:v.name,email:v.email,billingDay:Number(v.billingDay),expiry:v.expiry,capacity:Number(v.capacity),status:v.status,memo:v.memo});
  }else if(editing.type==='child'){
    replace(state.children,{id:editing.id||uid('c'),rootId:v.rootId,name:v.name,email:v.email,status:v.status,memo:v.memo});
  }else if(editing.type==='guest'){
    if(v.end<v.start){showToast('종료일은 시작일보다 빠를 수 없습니다.');return false}
    replace(state.guests,{id:editing.id||uid('g'),name:v.name,email:v.email,organization:v.organization,rootId:v.rootId,courseId:v.courseId||'',start:v.start,end:v.end,removedAt:editing.id?(state.guests.find(x=>x.id===editing.id)?.removedAt||''):'',memo:v.memo});
  }else{
    if(v.end<v.start){showToast('종료 일시는 시작 일시보다 빠를 수 없습니다.');return false}
    replace(state.courses,{id:editing.id||uid('co'),title:v.title,rootId:v.rootId||'',start:v.start,end:v.end,required:Number(v.required),assigned:0,memberMode:v.memberMode,manager:v.manager,status:v.status,memo:v.memo});
  }
  persist();return true;
}

function deleteRecord(){
  if(!editing?.id)return false;
  const {type,id}=editing;
  if(type==='root'){
    const root=state.roots.find(x=>x.id===id);
    const kids=state.children.filter(c=>c.rootId===id).length,gs=state.guests.filter(g=>g.rootId===id).length;
    if(!confirm(`'${root?.name}' 워크스페이스를 삭제합니다.\n상시 멤버 ${kids}명, 기간제 멤버 ${gs}명 기록도 함께 지워집니다.`))return false;
    state.roots=state.roots.filter(x=>x.id!==id);
    state.children=state.children.filter(c=>c.rootId!==id);
    state.guests=state.guests.filter(g=>g.rootId!==id);
    state.courses.forEach(c=>{if(c.rootId===id)c.rootId=''});
  }else if(type==='child'){
    const child=state.children.find(x=>x.id===id);
    if(!confirm(`상시 멤버 '${child?.name}'을(를) 삭제합니다.`))return false;
    state.children=state.children.filter(x=>x.id!==id);
  }else if(type==='guest'){
    const guest=state.guests.find(x=>x.id===id);
    if(!confirm(`기간제 멤버 '${guest?.name}'을(를) 삭제합니다.\n실제 워크스페이스에서 제거했는지 먼저 확인하세요.`))return false;
    state.guests=state.guests.filter(x=>x.id!==id);
  }else{
    const course=state.courses.find(x=>x.id===id);
    const linked=state.guests.filter(g=>g.courseId===id).length;
    if(!confirm(`강의 '${course?.title}'을(를) 삭제합니다.${linked?`\n연결된 기간제 멤버 ${linked}명은 강의 미지정으로 남습니다.`:''}`))return false;
    state.courses=state.courses.filter(x=>x.id!==id);
    state.guests.forEach(g=>{if(g.courseId===id)g.courseId=''});
  }
  persist();showToast('삭제했습니다.');return true;
}

// ---- 이벤트 ----------------------------------------------------------------
function switchView(view){currentView=view;document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`${view}View`));document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===view));const titles={dashboard:'운영 현황',accounts:'워크스페이스 관리',courses:'강의 일정',guests:'기간제 멤버',settings:'연결 설정'};document.querySelector('#pageTitle').textContent=titles[view];document.querySelector('.sidebar').classList.remove('open')}

document.addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t)return;
  if(t.dataset.view)switchView(t.dataset.view);
  if(t.dataset.go)switchView(t.dataset.go);
  if(t.dataset.add)openEditor(t.dataset.add);
  if(t.dataset.addChild)openEditor('child',null,t.dataset.addChild);
  if(t.dataset.editRoot)openEditor('root',t.dataset.editRoot);
  if(t.dataset.editChild)openEditor('child',t.dataset.editChild);
  if(t.dataset.editGuest)openEditor('guest',t.dataset.editGuest);
  if(t.dataset.editCourse)openEditor('course',t.dataset.editCourse);
  if(t.hasAttribute('data-close-editor'))document.querySelector('#editorDialog').close();
  if(t.id==='deleteRecord'&&deleteRecord())document.querySelector('#editorDialog').close();
  if(t.hasAttribute('data-open-import')){document.querySelector('#importForm').reset();document.querySelector('#importResult').className='import-result';document.querySelector('#importResult').textContent='';document.querySelector('#importDialog').showModal()}
  if(t.hasAttribute('data-close-import'))document.querySelector('#importDialog').close();
  if(t.dataset.removeGuest){const g=state.guests.find(x=>x.id===t.dataset.removeGuest);g.removedAt=isoDate(today);persist()}
  if(t.id==='quickAddButton')openEditor(currentView==='accounts'?'root':currentView==='guests'?'guest':'course');
  if(t.id==='menuButton')document.querySelector('.sidebar').classList.toggle('open');
  if(t.id==='prevMonth'){calendarDate=new Date(calendarDate.getFullYear(),calendarDate.getMonth()-1,1);renderCalendar()}
  if(t.id==='nextMonth'){calendarDate=new Date(calendarDate.getFullYear(),calendarDate.getMonth()+1,1);renderCalendar()}
  if(t.id==='refreshButton')loadRemote();
  if(t.id==='saveSettings'){const url=document.querySelector('#apiUrlInput').value.trim();if(url&&!/^https:\/\/script\.google\.com\//.test(url)){showToast('Apps Script 웹 앱 URL을 확인해 주세요.');return}url?localStorage.setItem('gpt-account-manager-api',url):localStorage.removeItem('gpt-account-manager-api');showToast('연결 설정을 저장했습니다.');loadRemote()}
  if(t.id==='disconnectButton'){localStorage.removeItem('gpt-account-manager-api');document.querySelector('#apiUrlInput').value='';setSync('','로컬 데이터');renderSettings();showToast('Sheets 연결을 해제했습니다.')}
});

document.querySelector('#editorForm').addEventListener('submit',e=>{e.preventDefault();if(saveEditor(e.currentTarget))document.querySelector('#editorDialog').close()});
document.querySelector('#importForm').addEventListener('submit',async e=>{e.preventDefault();const result=document.querySelector('#importResult'),file=document.querySelector('#csvFile').files[0];if(!file)return;try{const rows=parseCsv(await readCsvText(file));if(!rows.length)throw new Error('등록할 데이터가 없습니다.');const imported=importMembers(rows);if(imported.errors.length){result.className='import-result show';result.textContent=`등록 전 확인이 필요한 항목이 있습니다.\n${imported.errors.slice(0,8).join('\n')}${imported.errors.length>8?`\n외 ${imported.errors.length-8}건`:''}`;return}state.children.push(...imported.children);state.guests.push(...imported.guests);await persist();result.className='import-result show success';result.textContent=`상시 멤버 ${imported.children.length}명, 기간제 멤버 ${imported.guests.length}명을 등록했습니다.`;document.querySelector('#csvFile').value='';showToast('CSV 일괄 등록을 완료했습니다.')}catch(error){result.className='import-result show';result.textContent=error.message||'CSV 파일을 읽지 못했습니다.'}});
['accountSearch','accountFilter'].forEach(id=>document.querySelector(`#${id}`).addEventListener('input',renderAccounts));
['guestSearch','guestFilter'].forEach(id=>document.querySelector(`#${id}`).addEventListener('input',renderGuests));
document.querySelector('#ownerSeatToggle').addEventListener('change',e=>{state.settings.ownerUsesSeat=e.target.checked;persist()});

document.querySelector('#todayLabel').textContent=new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(today);
if(apiUrl())setSync('connected','Google Sheets 연결됨');
renderAll();loadRemote();
