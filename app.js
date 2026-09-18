const DAY = 86400000;
const today = new Date();
const isoDate = d => {const date=new Date(d);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`};
const TODAY = isoDate(today);
const addDays = n => isoDate(new Date(today.getTime() + n * DAY));
const uid = prefix => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const pad2 = v => String(v).padStart(2, "0");

const demoData = {
  slots: [
    {id:"s1",date:addDays(3),course:"태림페이퍼",name:"김동주",account:"coramdeo0916@example.com",memo:""},
    {id:"s2",date:addDays(3),course:"태림페이퍼",name:"김윤정",account:"kyja_a@example.com",memo:""},
    {id:"s3",date:addDays(3),course:"태림페이퍼",name:"김주원",account:"juwonhaha@example.com",memo:""},
    {id:"s4",date:addDays(4),course:"현대해상",name:"이재욱",account:"wodnr123dla@example.com",memo:""},
    {id:"s5",date:addDays(4),course:"현대해상",name:"이정섭",account:"jeongseob82@example.com",memo:""},
    {id:"s6",date:addDays(-2),course:"아그네스",name:"정의웅",account:"a01027825612@example.com",memo:"지난 일정"}
  ],
  settings:{}
};

let state = loadLocal();
let currentView = "roster";
let editing = null;
let selected = new Set();

function loadLocal(){try{return JSON.parse(localStorage.getItem("gpt-account-manager-data")) || structuredClone(demoData)}catch{return structuredClone(demoData)}}

// localStorage에 키가 있으면 빈 문자열이라도 그 값을 쓴다. 빈 문자열은 "이 브라우저에서는
// 연결하지 않겠다"는 명시적 표시라서, config.js 기본값으로 되돌아가면 안 된다.
const API_KEY = "gpt-account-manager-api";
function defaultApiUrl(){return window.APP_CONFIG?.appsScriptUrl || ""}
function apiUrl(){const saved=localStorage.getItem(API_KEY);return saved!==null?saved:defaultApiUrl()}
function apiSource(){const saved=localStorage.getItem(API_KEY);return saved===null?(defaultApiUrl()?"default":"none"):(saved?"custom":"off")}

function showToast(message){const el=document.querySelector("#toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2200)}
function fmtDay(d){return new Intl.DateTimeFormat("ko-KR",{month:"long",day:"numeric",weekday:"short"}).format(new Date(`${d}T00:00`))}
function daysFromToday(d){return Math.round((new Date(`${d}T00:00`) - new Date(`${TODAY}T00:00`))/DAY)}
function dLabel(d){const n=daysFromToday(d);return n===0?"오늘":n>0?`D-${n}`:`${-n}일 전`}

// ---- 날짜 해석 --------------------------------------------------------------
// 엑셀에서 온 "09월 21일(월)", "2026-09-21", "9/21" 같은 표기를 모두 받아들인다.
function parseDateCell(raw){
  const text = String(raw ?? "").trim();
  if(!text) return "";
  let m = text.match(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if(m) return valid(+m[1], +m[2], +m[3]);
  m = text.match(/(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if(m){
    const month=+m[1], day=+m[2];
    if(month<1||month>12||day<1||day>31) return "";
    let year = today.getFullYear();
    let candidate = valid(year, month, day);
    // 반년 이상 지난 날짜면 내년 것으로 본다. 연말·연초에 붙여넣을 때를 위한 처리다.
    if(candidate && candidate < isoDate(new Date(today.getTime() - 180*DAY))) candidate = valid(year+1, month, day);
    return candidate;
  }
  return "";
  function valid(y,mo,d){
    if(mo<1||mo>12||d<1||d>31) return "";
    const iso=`${y}-${pad2(mo)}-${pad2(d)}`;
    const check=new Date(`${iso}T00:00`);
    return Number.isNaN(check.getTime()) ? "" : iso;
  }
}
const looksLikeEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v??"").trim());

// ---- 저장 ------------------------------------------------------------------
function normalize(){
  state.slots ||= [];
  // 예전 화면에서 쓰던 시트는 이제 읽지 않지만, 저장할 때 통째로 비우지 않도록 형태만 지킨다.
  state.roots ||= [];state.children ||= [];state.guests ||= [];state.courses ||= [];
  state.settings ||= {};
  state.slots.forEach(s=>{
    s.id ||= uid('s');
    s.date = parseDateCell(s.date) || String(s.date ?? "").slice(0,10);
    ["course","name","account","memo"].forEach(k=>{s[k]=String(s[k] ?? "").trim()});
  });
  state.slots = state.slots.filter(s=>s.date && s.account);
}

async function loadRemote(){
  if(!apiUrl())return renderAll();
  setSync("loading","데이터 불러오는 중");
  try{
    const res=await fetch(`${apiUrl()}?action=all&t=${Date.now()}`);
    if(!res.ok)throw new Error();
    const json=await res.json();
    if(json.ok===false)throw new Error(json.error);
    state=json.data;normalize();
    localStorage.setItem("gpt-account-manager-data",JSON.stringify(state));
    setSync("connected","Google Sheets 연결됨");renderAll();
  }catch(e){
    setSync("error","연결 오류 · 로컬 데이터");
    showToast("Sheets 연결에 실패해 로컬 데이터를 표시합니다.");renderAll();
  }
}
async function persist(){
  normalize();renderAll();
  localStorage.setItem("gpt-account-manager-data",JSON.stringify(state));
  if(!apiUrl())return;
  setSync("loading","저장 중");
  try{
    const res=await fetch(apiUrl(),{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"saveAll",data:state})});
    const json=await res.json();
    if(json.ok===false)throw new Error(json.error);
    setSync("connected","Google Sheets 연결됨");showToast("Google Sheets에 저장했습니다.");
  }catch(e){
    setSync("error","동기화 실패 · 로컬 저장됨");showToast("로컬에는 저장했지만 Sheets 동기화에 실패했습니다.");
  }
}
function setSync(type,label){document.querySelector("#syncLabel").textContent=label;document.querySelector("#syncDot").className=`sync-dot ${type==="connected"?"connected":""}`}

// ---- 조회 ------------------------------------------------------------------
function searchText(){return document.querySelector("#rosterSearch").value.trim().toLowerCase()}
function showingPast(){return document.querySelector("#showPast").checked}
function matches(slot,q){return !q || [slot.course,slot.name,slot.account,slot.memo].join(" ").toLowerCase().includes(q)}

// 날짜별로 묶어 돌려준다. 지난 날짜는 기본으로 감춘다.
function groupedDates({includePast=showingPast(), query=searchText()}={}){
  const map=new Map();
  state.slots.forEach(s=>{
    if(!includePast && s.date < TODAY) return;
    if(!matches(s,query)) return;
    (map.get(s.date) || map.set(s.date,[]).get(s.date)).push(s);
  });
  return [...map.entries()].sort(([a],[b])=>a.localeCompare(b))
    .map(([date,rows])=>({date, rows:rows.slice().sort((x,y)=>
      (x.course||"").localeCompare(y.course||"") || (x.name||"").localeCompare(y.name||"") || x.account.localeCompare(y.account))}));
}
const pastCount = () => state.slots.filter(s=>s.date < TODAY).length;

// ---- 렌더 ------------------------------------------------------------------
function renderAll(){normalize();pruneSelection();renderHero();renderRoster();renderSettings()}

function renderHero(){
  const upcoming=groupedDates({includePast:false, query:""});
  const totalAccounts=upcoming.reduce((a,g)=>a+g.rows.length,0);
  const uniqueAccounts=new Set(upcoming.flatMap(g=>g.rows.map(r=>r.account.toLowerCase()))).size;
  const busiest=upcoming.slice().sort((a,b)=>b.rows.length-a.rows.length)[0];
  document.querySelector("#heroDays").textContent=upcoming.length;
  document.querySelector("#heroNote").textContent=upcoming.length
    ? `가장 가까운 일정은 ${fmtDay(upcoming[0].date)} · ${upcoming[0].rows.length}개 계정입니다.`
    : "등록된 다가오는 일정이 없습니다. 엑셀에서 붙여넣어 시작하세요.";
  const cards=[
    ['다가오는 일정', upcoming.length, '일', '▤'],
    ['총 계정', totalAccounts, `중복 제외 ${uniqueAccounts}개`, '◫'],
    ['가장 많은 날', busiest?busiest.rows.length:0, busiest?fmtDay(busiest.date):'없음', '↗'],
    ['지난 일정', pastCount(), '자동으로 숨김', '⏱']
  ];
  document.querySelector("#metrics").innerHTML=cards.map(x=>
    `<article class="metric"><div class="metric-head"><span>${x[0]}</span><i class="metric-icon">${x[3]}</i></div><strong>${x[1]}</strong><small>${escapeHtml(x[2])}</small></article>`).join("");
}

function renderRoster(){
  const groups=groupedDates();
  const past=pastCount();
  document.querySelector("#showPastLabel").textContent = past ? `지난 날짜 보기 (${past})` : "지난 날짜 보기";
  document.querySelector("#dateList").innerHTML = groups.length ? groups.map(g=>{
    const isPast=g.date<TODAY;
    return `<article class="card date-card ${isPast?'past':''}">
      <div class="date-head">
        <div class="date-title">
          <p class="eyebrow">${escapeHtml(dLabel(g.date))}</p>
          <h3>${escapeHtml(fmtDay(g.date))}</h3>
        </div>
        <span class="count-badge">${g.rows.length}</span>
        <div class="date-actions">
          <button class="mini-button" data-copy-date="${g.date}">복사</button>
          <button class="mini-button" data-add-date="${g.date}">+ 추가</button>
          <button class="mini-button" data-clear-date="${g.date}">비우기</button>
        </div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th class="check-col"><input type="checkbox" data-check-date="${g.date}" aria-label="${escapeHtml(fmtDay(g.date))} 전체 선택"></th>
          <th class="no-col">No</th><th>과정명</th><th>이름</th><th>계정</th><th>메모</th><th></th>
        </tr></thead>
        <tbody>${g.rows.map((s,i)=>`<tr>
          <td class="check-col"><input type="checkbox" data-slot="${s.id}" ${selected.has(s.id)?'checked':''} aria-label="${escapeHtml(s.account)} 선택"></td>
          <td class="no-col">${i+1}</td>
          <td>${escapeHtml(s.course||'-')}</td>
          <td>${escapeHtml(s.name||'-')}</td>
          <td><code class="account">${escapeHtml(s.account)}</code></td>
          <td class="memo-cell">${escapeHtml(s.memo||'')}</td>
          <td><div class="row-actions"><button class="mini-button" data-edit-slot="${s.id}">수정</button></div></td>
        </tr>`).join("")}</tbody>
      </table></div>
    </article>`;
  }).join("") : `<div class="card"><div class="empty">${searchText()?"검색 결과가 없습니다.":"등록된 일정이 없습니다. 오른쪽 위 <b>엑셀 붙여넣기</b>로 시작하세요."}</div></div>`;
  syncSelectionUi();
}

function renderSettings(){
  document.querySelector("#apiUrlInput").value=apiUrl();
  const hints={
    default:"config.js에 설정된 기본 주소로 연결합니다. 다른 주소를 쓰려면 위 칸에 입력하고 저장하세요.",
    custom:"이 브라우저에 저장된 주소를 사용합니다. 칸을 비우고 저장하면 기본 주소로 돌아갑니다.",
    off:"이 브라우저에서는 연결하지 않습니다. 칸을 비운 채 '연결 저장'을 누르면 기본 주소로 돌아갑니다.",
    none:"연결된 주소가 없어 이 브라우저에 저장된 데이터만 사용합니다."
  };
  document.querySelector("#connectionHint").textContent=hints[apiSource()];
}

// ---- 선택 ------------------------------------------------------------------
function pruneSelection(){const ids=new Set(state.slots.map(s=>s.id));[...selected].forEach(id=>{if(!ids.has(id))selected.delete(id)})}
function syncSelectionUi(){
  const boxes=[...document.querySelectorAll('#dateList input[data-slot]')];
  const checked=boxes.filter(b=>b.checked).length;
  document.querySelectorAll('#dateList input[data-check-date]').forEach(head=>{
    const rows=[...document.querySelectorAll(`#dateList input[data-slot]`)].filter(b=>b.closest('.date-card')===head.closest('.date-card'));
    const on=rows.filter(b=>b.checked).length;
    head.checked=rows.length>0&&on===rows.length;
    head.indeterminate=on>0&&on<rows.length;
  });
  const btn=document.querySelector('#deleteSelected');
  btn.hidden=checked===0;
  btn.textContent=`선택 ${checked}개 삭제`;
}

// ---- 엑셀 붙여넣기 ----------------------------------------------------------
const LABEL = {
  course: /과정|과목|교육|기업|고객/,
  name: /이름|성명|성함|담당/,
  account: /계정|이메일|메일|아이디|id/i,
  memo: /메모|비고|참고/
};

// 머리글에 날짜가 있는 표. 날짜 열에는 계정이 들어 있고, 그 앞의 열들이 과정명·이름이다.
function parseByDateHeader(rows){
  let headerIdx=-1, dateCols=[];
  for(let i=0;i<Math.min(rows.length,10);i++){
    const found=rows[i].map((cell,idx)=>({idx,date:parseDateCell(cell)})).filter(x=>x.date);
    if(found.length){headerIdx=i;dateCols=found;break}
  }
  if(headerIdx<0) return null;
  const header=rows[headerIdx].map(c=>String(c??"").trim());
  const groups=dateCols.map((col,i)=>{
    const from = i===0 ? 0 : dateCols[i-1].idx+1;
    const attrs={};
    for(let c=from;c<col.idx;c++){
      const label=header[c]||"";
      if(attrs.course===undefined && LABEL.course.test(label)) attrs.course=c;
      else if(attrs.name===undefined && LABEL.name.test(label)) attrs.name=c;
      else if(attrs.memo===undefined && LABEL.memo.test(label)) attrs.memo=c;
    }
    return {date:col.date, col:col.idx, attrs};
  });
  const slots=[];
  rows.slice(headerIdx+1).forEach(row=>{
    groups.forEach(g=>{
      const account=String(row[g.col]??"").trim();
      if(!account) return;
      slots.push({id:uid('s'),date:g.date,
        course:String(row[g.attrs.course]??"").trim(),
        name:String(row[g.attrs.name]??"").trim(),
        account,
        memo:String(row[g.attrs.memo]??"").trim()});
    });
  });
  return slots;
}

// 날짜 머리글이 없는 표. 화면에서 고른 날짜를 쓰고, 열은 머리글 이름이나 형태로 짐작한다.
function parseSingleDate(rows, date){
  if(!date) return null;
  const header=rows[0]?.map(c=>String(c??"").trim()) || [];
  const mapped={};
  header.forEach((label,idx)=>{
    Object.entries(LABEL).forEach(([key,re])=>{if(mapped[key]===undefined && re.test(label)) mapped[key]=idx});
  });
  const hasHeader=mapped.account!==undefined || (mapped.course!==undefined && mapped.name!==undefined);
  const body=hasHeader?rows.slice(1):rows;
  const slots=[];
  body.forEach(row=>{
    let account = mapped.account!==undefined ? String(row[mapped.account]??"").trim() : "";
    if(!account){const hit=row.find(looksLikeEmail);account=hit?String(hit).trim():""}
    if(!account) return;
    let course = mapped.course!==undefined ? String(row[mapped.course]??"").trim() : "";
    let name = mapped.name!==undefined ? String(row[mapped.name]??"").trim() : "";
    if(!course || !name){
      // 머리글이 없으면 숫자와 계정을 뺀 나머지 칸을 순서대로 과정명·이름으로 본다.
      const rest=row.map(c=>String(c??"").trim()).filter(c=>c && c!==account && !/^\d+$/.test(c));
      course=course||rest[0]||"";
      name=name||rest[1]||"";
    }
    slots.push({id:uid('s'),date,course,name,account,
      memo: mapped.memo!==undefined ? String(row[mapped.memo]??"").trim() : ""});
  });
  return slots;
}

function parsePasted(text, fallbackDate){
  const rows=String(text||"").replace(/\r\n?/g,"\n").split("\n").map(line=>line.split("\t"));
  while(rows.length && rows[rows.length-1].every(c=>!String(c??"").trim())) rows.pop();
  if(!rows.length) return {slots:[],error:"붙여넣은 내용이 없습니다."};
  const byHeader=parseByDateHeader(rows);
  if(byHeader) return byHeader.length ? {slots:byHeader} : {slots:[],error:"날짜 머리글은 찾았지만 계정이 들어 있는 행이 없습니다."};
  const single=parseSingleDate(rows, fallbackDate);
  if(single===null) return {slots:[],error:"머리글에서 날짜를 찾지 못했습니다. 위에서 날짜를 골라 주세요."};
  return single.length ? {slots:single} : {slots:[],error:"계정이 들어 있는 행을 찾지 못했습니다."};
}

function previewPaste(){
  const box=document.querySelector("#pasteResult");
  const text=document.querySelector("#pasteInput").value;
  if(!text.trim()){box.className="import-result";box.textContent="";return null}
  const {slots,error}=parsePasted(text, document.querySelector("#pasteDate").value);
  if(error){box.className="import-result show";box.textContent=error;return null}
  const dates=[...new Set(slots.map(s=>s.date))].sort();
  const sample=slots.slice(0,3).map(s=>`${s.date} · ${s.course||'-'} · ${s.name||'-'} · ${s.account}`).join("\n");
  box.className="import-result show success";
  box.textContent=`${dates.length}개 날짜, 계정 ${slots.length}개를 찾았습니다.\n${dates.map(d=>`${d} (${slots.filter(s=>s.date===d).length})`).join(", ")}\n\n${sample}${slots.length>3?`\n… 외 ${slots.length-3}개`:""}`;
  return slots;
}

// ---- 편집 ------------------------------------------------------------------
const field=(name,label,type,value,extra="")=>`<label>${label}<input name="${name}" type="${type}" value="${escapeHtml(value)}" ${extra}></label>`;
function openEditor(id=null, date=""){
  editing=id;
  const item=state.slots.find(s=>s.id===id) || {};
  document.querySelector("#dialogTitle").textContent=id?"계정 수정":"계정 추가";
  document.querySelector("#dialogEyebrow").textContent=id?"EDIT RECORD":"NEW RECORD";
  document.querySelector("#formFields").innerHTML=
    field("date","날짜","date",item.date||date||TODAY,"required")
    +field("account","계정","text",item.account,"required placeholder=\"name@example.com\"")
    +field("course","과정명","text",item.course)
    +field("name","이름","text",item.name)
    +`<label class="full">메모<input name="memo" type="text" value="${escapeHtml(item.memo||"")}"></label>`;
  document.querySelector("#deleteRecord").hidden=!id;
  document.querySelector("#editorDialog").showModal();
}
function saveEditor(form){
  const v=Object.fromEntries(new FormData(form));
  const date=parseDateCell(v.date);
  if(!date){showToast("날짜를 확인해 주세요.");return false}
  if(!String(v.account).trim()){showToast("계정을 입력해 주세요.");return false}
  const item={id:editing||uid('s'),date,account:String(v.account).trim(),course:String(v.course).trim(),name:String(v.name).trim(),memo:String(v.memo).trim()};
  const found=state.slots.find(s=>s.id===editing);
  found?Object.assign(found,item):state.slots.push(item);
  persist();return true;
}
function deleteRecord(){
  const item=state.slots.find(s=>s.id===editing);
  if(!item)return false;
  if(!confirm(`${item.date} · ${item.account}\n이 계정 행을 삭제합니다.`))return false;
  state.slots=state.slots.filter(s=>s.id!==editing);
  persist();showToast("삭제했습니다.");return true;
}

// ---- 복사 ------------------------------------------------------------------
function toTsv(slots){
  return ["날짜\t과정명\t이름\t계정\t메모",
    ...slots.map(s=>[s.date,s.course,s.name,s.account,s.memo].join("\t"))].join("\n");
}
async function copyText(text, message){
  try{await navigator.clipboard.writeText(text);showToast(message)}
  catch{
    const ta=document.createElement("textarea");ta.value=text;document.body.appendChild(ta);ta.select();
    try{document.execCommand("copy");showToast(message)}catch{showToast("복사에 실패했습니다.")}
    ta.remove();
  }
}

// ---- 이벤트 ----------------------------------------------------------------
function switchView(view){
  currentView=view;
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`${view}View`));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===view));
  document.querySelector('#pageTitle').textContent={roster:'계정 일정',settings:'연결 설정'}[view];
  document.querySelector('.sidebar').classList.remove('open');
}

document.addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t)return;
  if(t.dataset.view)switchView(t.dataset.view);
  if(t.dataset.editSlot)openEditor(t.dataset.editSlot);
  if(t.dataset.addDate)openEditor(null,t.dataset.addDate);
  if(t.id==='addSlotButton')openEditor();
  if(t.hasAttribute('data-close-editor'))document.querySelector('#editorDialog').close();
  if(t.id==='deleteRecord'&&deleteRecord())document.querySelector('#editorDialog').close();

  if(t.dataset.copyDate){
    const group=groupedDates({includePast:true}).find(g=>g.date===t.dataset.copyDate);
    if(group)copyText(toTsv(group.rows),`${fmtDay(group.date)} ${group.rows.length}개를 복사했습니다.`);
  }
  if(t.dataset.clearDate){
    const date=t.dataset.clearDate, rows=state.slots.filter(s=>s.date===date);
    if(rows.length && confirm(`${fmtDay(date)}의 계정 ${rows.length}개를 모두 삭제합니다.`)){
      state.slots=state.slots.filter(s=>s.date!==date);persist();showToast(`${rows.length}개를 삭제했습니다.`);
    }
  }
  if(t.id==='deleteSelected'){
    const targets=state.slots.filter(s=>selected.has(s.id));
    if(targets.length && confirm(`선택한 계정 ${targets.length}개를 삭제합니다.`)){
      state.slots=state.slots.filter(s=>!selected.has(s.id));selected.clear();persist();showToast(`${targets.length}개를 삭제했습니다.`);
    }
  }
  if(t.id==='copyAllButton'){
    const rows=groupedDates().flatMap(g=>g.rows);
    rows.length?copyText(toTsv(rows),`${rows.length}개를 복사했습니다.`):showToast("복사할 일정이 없습니다.");
  }
  if(t.id==='clearPastButton'){
    const rows=state.slots.filter(s=>s.date<TODAY);
    if(!rows.length){showToast("지난 일정이 없습니다.");return}
    if(confirm(`지난 날짜의 계정 ${rows.length}개를 모두 삭제합니다.\n되돌릴 수 없습니다.`)){
      state.slots=state.slots.filter(s=>s.date>=TODAY);persist();showToast(`지난 일정 ${rows.length}개를 삭제했습니다.`);
    }
  }

  if(t.id==='pasteButton'){
    const form=document.querySelector('#pasteForm');form.reset();
    document.querySelector('#pasteResult').className='import-result';
    document.querySelector('#pasteResult').textContent='';
    document.querySelector('#pasteDialog').showModal();
    setTimeout(()=>document.querySelector('#pasteInput').focus(),50);
  }
  if(t.hasAttribute('data-close-paste'))document.querySelector('#pasteDialog').close();

  if(t.id==='menuButton')document.querySelector('.sidebar').classList.toggle('open');
  if(t.id==='refreshButton')loadRemote();
  if(t.id==='saveSettings'){
    const url=document.querySelector('#apiUrlInput').value.trim();
    if(url&&!/^https:\/\/script\.google\.com\//.test(url)){showToast('Apps Script 웹 앱 URL을 확인해 주세요.');return}
    url?localStorage.setItem(API_KEY,url):localStorage.removeItem(API_KEY);
    showToast(url?'연결 설정을 저장했습니다.':'기본 주소로 되돌렸습니다.');renderSettings();loadRemote();
  }
  if(t.id==='disconnectButton'){
    localStorage.setItem(API_KEY,'');document.querySelector('#apiUrlInput').value='';
    setSync('','로컬 데이터');renderSettings();showToast('이 브라우저에서 Sheets 연결을 해제했습니다.');
  }
});

document.querySelector('#editorForm').addEventListener('submit',e=>{e.preventDefault();if(saveEditor(e.currentTarget))document.querySelector('#editorDialog').close()});

document.querySelector('#pasteForm').addEventListener('submit',e=>{
  e.preventDefault();
  const slots=previewPaste();
  if(!slots||!slots.length)return;
  const mode=document.querySelector('#pasteMode').value;
  if(mode==='replace'){
    const dates=new Set(slots.map(s=>s.date));
    state.slots=state.slots.filter(s=>!dates.has(s.date));
  }
  state.slots.push(...slots);
  selected.clear();persist();
  document.querySelector('#pasteDialog').close();
  showToast(`계정 ${slots.length}개를 등록했습니다.`);
});
document.querySelector('#pasteInput').addEventListener('input',previewPaste);
document.querySelector('#pasteDate').addEventListener('change',previewPaste);

document.querySelector('#rosterSearch').addEventListener('input',renderRoster);
document.querySelector('#showPast').addEventListener('change',()=>{selected.clear();renderRoster()});
document.querySelector('#dateList').addEventListener('change',e=>{
  const row=e.target.closest('input[data-slot]');
  if(row){row.checked?selected.add(row.dataset.slot):selected.delete(row.dataset.slot);syncSelectionUi();return}
  const head=e.target.closest('input[data-check-date]');
  if(head){
    const card=head.closest('.date-card');
    card.querySelectorAll('input[data-slot]').forEach(box=>{
      box.checked=head.checked;
      head.checked?selected.add(box.dataset.slot):selected.delete(box.dataset.slot);
    });
    syncSelectionUi();
  }
});

document.querySelector('#todayLabel').textContent=new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(today);
if(apiUrl())setSync('connected','Google Sheets 연결됨');
renderAll();loadRemote();
