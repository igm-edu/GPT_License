const DAY = 86400000;
const today = new Date();
const isoDate = d => {const date=new Date(d);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`};
const TODAY = isoDate(today);
const addDays = n => isoDate(new Date(today.getTime() + n * DAY));
const uid = prefix => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const pad2 = v => String(v).padStart(2, "0");
const FIELDS = ["date","course","name","account","memo"];

const demoData = {
  slots: [
    {id:"s1",date:addDays(0),course:"태림페이퍼",name:"김동주",account:"coramdeo0916@example.com",memo:""},
    {id:"s2",date:addDays(0),course:"태림페이퍼",name:"김윤정",account:"kyja_a@example.com",memo:""},
    {id:"s3",date:addDays(1),course:"현대해상",name:"이재욱",account:"wodnr123dla@example.com",memo:""},
    {id:"s4",date:addDays(-3),course:"아그네스",name:"정의웅",account:"a01027825612@example.com",memo:"지난 일정"}
  ],
  settings:{}
};

let state = loadLocal();
let currentView = "roster";
let selected = new Set();
let lastDeleted = null;
let saveTimer = null;

function loadLocal(){try{return JSON.parse(localStorage.getItem("gpt-account-manager-data")) || structuredClone(demoData)}catch{return structuredClone(demoData)}}

// localStorage에 키가 있으면 빈 문자열이라도 그 값을 쓴다. 빈 문자열은 "이 브라우저에서는
// 연결하지 않겠다"는 명시적 표시라서, config.js 기본값으로 되돌아가면 안 된다.
const API_KEY = "gpt-account-manager-api";
function defaultApiUrl(){return window.APP_CONFIG?.appsScriptUrl || ""}
function apiUrl(){const saved=localStorage.getItem(API_KEY);return saved!==null?saved:defaultApiUrl()}
function apiSource(){const saved=localStorage.getItem(API_KEY);return saved===null?(defaultApiUrl()?"default":"none"):(saved?"custom":"off")}

function showToast(message, undo){
  const el=document.querySelector("#toast"), action=document.querySelector("#toastAction");
  document.querySelector("#toastText").textContent=message;
  action.hidden=!undo;
  action.onclick=undo?()=>{undo();el.classList.remove("show")}:null;
  el.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer=setTimeout(()=>el.classList.remove("show"), undo?6000:2200);
}
function fmtDay(d){try{return new Intl.DateTimeFormat("ko-KR",{month:"long",day:"numeric",weekday:"short"}).format(new Date(`${d}T00:00`))}catch{return d}}

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
    let candidate = valid(today.getFullYear(), month, day);
    // 반년 이상 지난 날짜면 내년 것으로 본다. 연말·연초에 붙여넣을 때를 위한 처리다.
    if(candidate && candidate < isoDate(new Date(today.getTime() - 180*DAY))) candidate = valid(today.getFullYear()+1, month, day);
    return candidate;
  }
  return "";
  function valid(y,mo,d){
    if(mo<1||mo>12||d<1||d>31) return "";
    const iso=`${y}-${pad2(mo)}-${pad2(d)}`;
    return Number.isNaN(new Date(`${iso}T00:00`).getTime()) ? "" : iso;
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
  // 날짜와 계정이 모두 빈 행은 흔적만 남은 줄이므로 버린다.
  state.slots = state.slots.filter(s=>s.date || s.account || s.course || s.name || s.memo);
}
function saveLocal(){localStorage.setItem("gpt-account-manager-data",JSON.stringify(state))}

// 칸을 고칠 때마다 시트로 보내면 너무 잦다. 로컬은 즉시, 원격은 잠시 모았다 보낸다.
function queueSave(){
  saveLocal();
  if(!apiUrl())return;
  setSync("loading","저장 대기 중");
  clearTimeout(saveTimer);
  saveTimer=setTimeout(pushRemote, 1200);
}
async function pushRemote(){
  if(!apiUrl())return;
  setSync("loading","저장 중");
  try{
    const res=await fetch(apiUrl(),{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"saveAll",data:state})});
    const json=await res.json();
    if(json.ok===false)throw new Error(json.error);
    setSync("connected","Google Sheets 연결됨");
  }catch(e){
    setSync("error","동기화 실패 · 로컬 저장됨");
    showToast("로컬에는 저장했지만 Sheets 동기화에 실패했습니다.");
  }
}
// 행이 늘거나 줄면 화면을 다시 그리고 저장한다.
function commit(){normalize();renderAll();queueSave()}

async function loadRemote(){
  if(!apiUrl())return renderAll();
  setSync("loading","데이터 불러오는 중");
  try{
    const res=await fetch(`${apiUrl()}?action=all&t=${Date.now()}`);
    if(!res.ok)throw new Error();
    const json=await res.json();
    if(json.ok===false)throw new Error(json.error);
    state=json.data;normalize();saveLocal();
    setSync("connected","Google Sheets 연결됨");renderAll();
  }catch(e){
    setSync("error","연결 오류 · 로컬 데이터");
    showToast("Sheets 연결에 실패해 로컬 데이터를 표시합니다.");renderAll();
  }
}
function setSync(type,label){document.querySelector("#syncLabel").textContent=label;document.querySelector("#syncDot").className=`sync-dot ${type==="connected"?"connected":""}`}

// ---- 조회 ------------------------------------------------------------------
const searchText = () => document.querySelector("#rosterSearch").value.trim().toLowerCase();
const showingPast = () => document.querySelector("#showPast").checked;
const pastCount = () => state.slots.filter(s=>s.date && s.date < TODAY).length;

function visibleSlots(){
  const q=searchText(), past=showingPast();
  return state.slots
    .filter(s=>(past || !s.date || s.date >= TODAY))
    .filter(s=>!q || [s.date,s.course,s.name,s.account,s.memo].join(" ").toLowerCase().includes(q))
    // 날짜로만 정렬한다. 같은 날짜 안에서는 입력한 순서를 지켜야 편집 중 행이 튀지 않는다.
    .slice().sort((a,b)=>(a.date||"9999-99-99").localeCompare(b.date||"9999-99-99"));
}

// ---- 렌더 ------------------------------------------------------------------
function renderAll(){normalize();pruneSelection();renderStats();renderSheet();renderSettings()}

function renderStats(){
  const upcoming=state.slots.filter(s=>s.date>=TODAY);
  const days=new Set(upcoming.map(s=>s.date)).size;
  const unique=new Set(upcoming.map(s=>s.account.toLowerCase()).filter(Boolean)).size;
  const byDay={};upcoming.forEach(s=>{byDay[s.date]=(byDay[s.date]||0)+1});
  const peak=Object.entries(byDay).sort((a,b)=>b[1]-a[1])[0];
  const cards=[
    ["다가오는 일정",days,"일"],
    ["총 계정",upcoming.length,`중복 제외 ${unique}개`],
    ["가장 많은 날",peak?peak[1]:0,peak?fmtDay(peak[0]):"없음"],
    ["지난 일정",pastCount(),"자동으로 숨김"]
  ];
  document.querySelector("#statStrip").innerHTML=cards.map(c=>
    `<div class="stat"><span>${c[0]}</span><strong>${c[1]}</strong><small>${escapeHtml(c[2])}</small></div>`).join("");
}

const cell = (id,field,value,type="text") =>
  `<td class="${field}-cell"><input class="cell" type="${type}" data-id="${id}" data-field="${field}" value="${escapeHtml(value)}" ${field==='account'?'inputmode="email" spellcheck="false"':''}></td>`;

function renderSheet(){
  const rows=visibleSlots();
  const body=document.querySelector("#sheetBody");
  let prevDate=null;
  const html=rows.map((s,i)=>{
    const groupStart = s.date!==prevDate;
    prevDate=s.date;
    const isPast = s.date && s.date < TODAY;
    return `<tr data-row="${s.id}" class="${isPast?'past':''} ${groupStart?'group-start':''}">
      <td class="check-col"><input type="checkbox" data-sel="${s.id}" ${selected.has(s.id)?'checked':''} aria-label="행 선택"></td>
      <td class="no-col">${i+1}</td>
      ${cell(s.id,"date",s.date,"date")}
      ${cell(s.id,"course",s.course)}
      ${cell(s.id,"name",s.name)}
      ${cell(s.id,"account",s.account)}
      ${cell(s.id,"memo",s.memo)}
      <td class="end-col"><button class="row-delete" data-del="${s.id}" title="행 삭제" aria-label="행 삭제">×</button></td>
    </tr>`;
  }).join("");
  // 맨 아래 빈 줄. 여기에 입력하면 새 행이 생긴다.
  const nextDate = rows.length ? rows[rows.length-1].date : TODAY;
  const blank=`<tr data-row="__new__" class="blank-row">
    <td class="check-col"></td><td class="no-col">+</td>
    ${cell("__new__","date",nextDate,"date")}
    ${cell("__new__","course","")}
    ${cell("__new__","name","")}
    ${cell("__new__","account","")}
    ${cell("__new__","memo","")}
    <td class="end-col"></td></tr>`;
  body.innerHTML = html + blank;
  document.querySelector("#showPastLabel").textContent = pastCount() ? `지난 날짜 보기 (${pastCount()})` : "지난 날짜 보기";
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
  const boxes=[...document.querySelectorAll('#sheetBody input[data-sel]')];
  const checked=boxes.filter(b=>b.checked).length;
  const all=document.querySelector('#selectAll');
  all.checked=boxes.length>0&&checked===boxes.length;
  all.indeterminate=checked>0&&checked<boxes.length;
  const btn=document.querySelector('#deleteSelected');
  btn.hidden=checked===0;
  btn.textContent=`선택 ${checked}개 삭제`;
}

// ---- 칸 편집 ----------------------------------------------------------------
function applyEdit(id, field, raw){
  const value = field==="date" ? (parseDateCell(raw) || "") : String(raw).trim();
  if(id==="__new__"){
    // 빈 줄에 뭔가 적으면 실제 행으로 만든다.
    const blank=document.querySelector('tr[data-row="__new__"]');
    const draft={id:uid('s'),date:"",course:"",name:"",account:"",memo:""};
    FIELDS.forEach(f=>{
      const input=blank.querySelector(`input[data-field="${f}"]`);
      draft[f]= f==="date" ? (parseDateCell(input.value)||"") : input.value.trim();
    });
    draft[field]=value;
    if(!draft.date) draft.date=TODAY;
    state.slots.push(draft);
    commit();
    // 새로 생긴 행의 같은 칸으로 초점을 돌려준다.
    const next=document.querySelector(`input[data-id="${draft.id}"][data-field="${field}"]`);
    if(next){next.focus();next.setSelectionRange?.(next.value.length,next.value.length)}
    return;
  }
  const slot=state.slots.find(s=>s.id===id);
  if(!slot)return;
  if(slot[field]===value){if(field==="date")renderSheet();return}
  slot[field]=value;
  // 날짜가 바뀌면 정렬 위치가 달라지므로 다시 그린다.
  if(field==="date"){commit()}
  else{saveLocal();queueSave();renderStats()}
}

function deleteRows(ids, label){
  const removed=state.slots.filter(s=>ids.includes(s.id));
  if(!removed.length)return;
  const snapshot=removed.map(s=>({...s}));
  state.slots=state.slots.filter(s=>!ids.includes(s.id));
  ids.forEach(id=>selected.delete(id));
  commit();
  showToast(label||`${removed.length}개 행을 삭제했습니다.`, ()=>{
    state.slots.push(...snapshot);commit();showToast("되돌렸습니다.");
  });
}

// 칸 안에서 Ctrl+V 하면 엑셀 표가 그 칸부터 아래·오른쪽으로 채워진다.
function pasteIntoSheet(startInput, text){
  const grid=String(text).replace(/\r\n?/g,"\n").split("\n").map(l=>l.split("\t"));
  while(grid.length && grid[grid.length-1].every(c=>!String(c).trim())) grid.pop();
  if(!grid.length)return false;
  const startField=startInput.dataset.field;
  const startCol=FIELDS.indexOf(startField);
  if(startCol<0)return false;
  const order=visibleSlots().map(s=>s.id);
  let rowIdx=order.indexOf(startInput.dataset.id);
  const appending=startInput.dataset.id==="__new__";
  if(rowIdx<0 && !appending)return false;
  // 붙여넣은 표에 날짜 열이 없으면 그 줄에 보이던 날짜를 쓴다.
  const rowOf=startInput.closest('tr');
  const fallbackDate=parseDateCell(rowOf?.querySelector('input[data-field="date"]')?.value) || TODAY;

  let touched=0;
  grid.forEach((line,r)=>{
    const targetId = appending ? null : order[rowIdx+r];
    let slot = targetId ? state.slots.find(s=>s.id===targetId) : null;
    if(!slot){
      slot={id:uid('s'),date:"",course:"",name:"",account:"",memo:""};
      state.slots.push(slot);
    }
    line.forEach((raw,c)=>{
      const field=FIELDS[startCol+c];
      if(!field)return;
      slot[field]= field==="date" ? (parseDateCell(raw)||slot.date) : String(raw).trim();
    });
    if(!slot.date) slot.date=fallbackDate;
    touched++;
  });
  commit();
  showToast(`${touched}개 행을 붙여넣었습니다.`);
  return true;
}

// ---- 엑셀 붙여넣기 창 (날짜가 여러 열로 나뉜 표) -------------------------------
const LABEL = {
  course: /과정|과목|교육|기업|고객/,
  name: /이름|성명|성함|담당/,
  account: /계정|이메일|메일|아이디|id/i,
  memo: /메모|비고|참고/
};
function parseByDateHeader(rows){
  let headerIdx=-1, dateCols=[];
  for(let i=0;i<Math.min(rows.length,10);i++){
    const found=rows[i].map((cellValue,idx)=>({idx,date:parseDateCell(cellValue)})).filter(x=>x.date);
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
        account, memo:String(row[g.attrs.memo]??"").trim()});
    });
  });
  return slots;
}
function parseSingleDate(rows, date){
  if(!date) return null;
  const header=rows[0]?.map(c=>String(c??"").trim()) || [];
  const mapped={};
  header.forEach((label,idx)=>{
    Object.entries(LABEL).forEach(([key,re])=>{if(mapped[key]===undefined && re.test(label)) mapped[key]=idx});
  });
  const hasHeader=mapped.account!==undefined || (mapped.course!==undefined && mapped.name!==undefined);
  const slots=[];
  (hasHeader?rows.slice(1):rows).forEach(row=>{
    let account = mapped.account!==undefined ? String(row[mapped.account]??"").trim() : "";
    if(!account){const hit=row.find(looksLikeEmail);account=hit?String(hit).trim():""}
    if(!account) return;
    let course = mapped.course!==undefined ? String(row[mapped.course]??"").trim() : "";
    let name = mapped.name!==undefined ? String(row[mapped.name]??"").trim() : "";
    if(!course || !name){
      // 머리글이 없으면 숫자와 계정을 뺀 나머지 칸을 순서대로 과정명·이름으로 본다.
      const rest=row.map(c=>String(c??"").trim()).filter(c=>c && c!==account && !/^\d+$/.test(c));
      course=course||rest[0]||"";name=name||rest[1]||"";
    }
    slots.push({id:uid('s'),date,course,name,account,memo: mapped.memo!==undefined ? String(row[mapped.memo]??"").trim() : ""});
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
  box.className="import-result show success";
  box.textContent=`${dates.length}개 날짜, 계정 ${slots.length}개를 찾았습니다.\n${dates.map(d=>`${d} (${slots.filter(s=>s.date===d).length})`).join(", ")}`;
  return slots;
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

const sheetBody = document.querySelector('#sheetBody');

sheetBody.addEventListener('change',e=>{
  const input=e.target.closest('input.cell');
  if(input){applyEdit(input.dataset.id,input.dataset.field,input.value);return}
  const box=e.target.closest('input[data-sel]');
  if(box){box.checked?selected.add(box.dataset.sel):selected.delete(box.dataset.sel);syncSelectionUi()}
});

// Enter와 위아래 화살표로 같은 열을 오르내린다. Tab은 브라우저 기본 동작을 쓴다.
sheetBody.addEventListener('keydown',e=>{
  const input=e.target.closest('input.cell');
  if(!input)return;
  if(e.key!=='Enter'&&e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;
  if(input.type==='date'&&(e.key==='ArrowDown'||e.key==='ArrowUp'))return; // 날짜 칸의 값 증감은 그대로 둔다
  e.preventDefault();
  input.blur();
  const rows=[...sheetBody.querySelectorAll('tr')];
  const here=rows.indexOf(input.closest('tr'));
  const step=e.key==='ArrowUp'?-1:1;
  const target=rows[here+step]?.querySelector(`input[data-field="${input.dataset.field}"]`);
  if(target){target.focus();target.select?.()}
});

sheetBody.addEventListener('paste',e=>{
  const input=e.target.closest('input.cell');
  if(!input)return;
  const text=e.clipboardData?.getData('text/plain')||"";
  if(!/[\t\n]/.test(text))return;   // 값 하나면 평범하게 붙여넣는다
  e.preventDefault();
  pasteIntoSheet(input,text);
});

document.querySelector('#selectAll').addEventListener('change',e=>{
  sheetBody.querySelectorAll('input[data-sel]').forEach(box=>{
    box.checked=e.target.checked;
    e.target.checked?selected.add(box.dataset.sel):selected.delete(box.dataset.sel);
  });
  syncSelectionUi();
});

document.addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t)return;
  if(t.dataset.view)switchView(t.dataset.view);
  if(t.dataset.del){
    const slot=state.slots.find(s=>s.id===t.dataset.del);
    deleteRows([t.dataset.del], slot?`${slot.date} ${slot.account||'빈 행'} 삭제`:"삭제했습니다.");
  }
  if(t.id==='deleteSelected')deleteRows([...selected]);
  if(t.id==='addRowButton'){
    const last=state.slots.slice().sort((a,b)=>(a.date||"").localeCompare(b.date||"")).pop();
    state.slots.push({id:uid('s'),date:last?.date||TODAY,course:"",name:"",account:"",memo:""});
    commit();
    const rows=[...sheetBody.querySelectorAll('tr[data-row]')];
    rows[rows.length-2]?.querySelector('input[data-field="course"]')?.focus();
  }
  if(t.id==='copyAllButton'){
    const rows=visibleSlots();
    rows.length?copyText(toTsv(rows),`${rows.length}개 행을 복사했습니다.`):showToast("복사할 일정이 없습니다.");
  }
  if(t.id==='clearPastButton'){
    const ids=state.slots.filter(s=>s.date&&s.date<TODAY).map(s=>s.id);
    if(!ids.length){showToast("지난 일정이 없습니다.");return}
    if(confirm(`지난 날짜의 행 ${ids.length}개를 삭제합니다.`))deleteRows(ids,`지난 일정 ${ids.length}개를 삭제했습니다.`);
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

document.querySelector('#pasteForm').addEventListener('submit',e=>{
  e.preventDefault();
  const slots=previewPaste();
  if(!slots||!slots.length)return;
  if(document.querySelector('#pasteMode').value==='replace'){
    const dates=new Set(slots.map(s=>s.date));
    state.slots=state.slots.filter(s=>!dates.has(s.date));
  }
  state.slots.push(...slots);
  selected.clear();commit();
  document.querySelector('#pasteDialog').close();
  showToast(`계정 ${slots.length}개를 등록했습니다.`);
});
document.querySelector('#pasteInput').addEventListener('input',previewPaste);
document.querySelector('#pasteDate').addEventListener('change',previewPaste);

document.querySelector('#rosterSearch').addEventListener('input',renderSheet);
document.querySelector('#showPast').addEventListener('change',()=>{selected.clear();renderSheet()});

// 편집 중에 창을 닫아도 마지막 내용이 시트에 남도록 한다.
window.addEventListener('beforeunload',()=>{if(saveTimer){clearTimeout(saveTimer);saveLocal()}});

document.querySelector('#todayLabel').textContent=new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(today);
if(apiUrl())setSync('connected','Google Sheets 연결됨');
renderAll();loadRemote();
