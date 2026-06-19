import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, setDoc, updateDoc, deleteDoc, getDocs, writeBatch, serverTimestamp, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const state = { app:null, auth:null, db:null, equipamentos:[], filtered:[], page:1, perPage:25, user:null };

function toast(msg){ const t=$("toast"); t.textContent=msg; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),2800); }
function errorText(e){ return e?.message || e?.code || String(e) || "Erro desconhecido"; }
function validConfig(){
  const c = window.firebaseConfig || {};
  return c.apiKey && !c.apiKey.includes("COLE_") && c.projectId && c.projectId !== "SEU_PROJETO";
}
function initFirebase(){
  if(!validConfig()){
    $("configNotice").innerHTML = "⚠️ Configure o arquivo <b>firebase-config.js</b> antes de usar.";
    $("loginMsg").textContent = "Firebase ainda não configurado.";
    return false;
  }
  try{
    state.app = initializeApp(window.firebaseConfig);
    state.auth = getAuth(state.app);
    state.db = getFirestore(state.app);
    $("configNotice").textContent = "Firebase configurado. Faça login ou crie o primeiro usuário.";
    onAuthStateChanged(state.auth, async (user)=>{
      state.user = user;
      if(user){ $("loginScreen").classList.add("hidden"); $("appScreen").classList.remove("hidden"); $("userInfo").textContent = user.email; await loadEquipamentos(); await loadHistory(); }
      else { $("loginScreen").classList.remove("hidden"); $("appScreen").classList.add("hidden"); }
    });
    return true;
  }catch(e){
    $("loginMsg").textContent = "Erro na configuração Firebase: " + errorText(e);
    return false;
  }
}
async function login(){
  $("loginMsg").textContent="";
  try{ await signInWithEmailAndPassword(state.auth, $("email").value.trim(), $("password").value); }
  catch(e){ $("loginMsg").textContent = "Erro ao entrar: " + errorText(e); }
}
async function createUser(){
  $("loginMsg").textContent="";
  try{ await createUserWithEmailAndPassword(state.auth, $("email").value.trim(), $("password").value); toast("Usuário criado com sucesso"); }
  catch(e){ $("loginMsg").textContent = "Erro ao criar usuário: " + errorText(e); }
}
async function loadEquipamentos(){
  const snap = await getDocs(collection(state.db, "equipamentos"));
  state.equipamentos = snap.docs.map(d=>({id:d.id, ...d.data()}));
  state.equipamentos.sort((a,b)=>(a.tipo||"").localeCompare(b.tipo||"") || (a.local||"").localeCompare(b.local||""));
  fillFilters(); applyFilters(); renderDashboard();
}
function fillFilters(){
  fillSelect("filterTipo", [...new Set(state.equipamentos.map(x=>x.tipo).filter(Boolean))]);
  fillSelect("filterStatus", [...new Set(state.equipamentos.map(x=>x.status).filter(Boolean))]);
  fillSelect("filterLocal", [...new Set(state.equipamentos.map(x=>x.local).filter(Boolean))].sort());
}
function fillSelect(id, values){
  const el=$(id), current=el.value, first=el.options[0].textContent;
  el.innerHTML = `<option value="">${first}</option>` + values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");
  el.value = current;
}
function applyFilters(){
  const term = $("searchInput")?.value?.toLowerCase() || "";
  const tipo = $("filterTipo")?.value || "", status = $("filterStatus")?.value || "", local = $("filterLocal")?.value || "";
  state.filtered = state.equipamentos.filter(e=>{
    const blob = Object.values(e).join(" ").toLowerCase();
    return (!term || blob.includes(term)) && (!tipo || e.tipo===tipo) && (!status || e.status===status) && (!local || e.local===local);
  });
  state.page=1; renderTable();
}
function renderTable(){
  const total=state.filtered.length, pages=Math.max(1, Math.ceil(total/state.perPage));
  state.page=Math.min(state.page,pages);
  const rows=state.filtered.slice((state.page-1)*state.perPage, state.page*state.perPage);
  $("equipTable").innerHTML = rows.map(e=>`
    <tr>
      <td>${esc(e.tipo)}</td><td>${esc(e.modelo||e.categoria)}</td><td>${esc(e.numeroSerie||e.imei)}</td><td>${esc(e.patrimonio)}</td>
      <td>${esc(e.hostname)}</td><td>${esc(e.local)}</td><td>${esc(e.responsavel)}</td><td><span class="pill ${pillClass(e.status)}">${esc(e.status||"Ativo")}</span></td>
      <td><button class="btn small secondary" data-edit="${e.id}">Editar</button> <button class="btn small danger" data-del="${e.id}">Excluir</button></td>
    </tr>`).join("");
  $("resultCount").textContent = `${total} itens`;
  $("pageInfo").textContent = `${state.page} / ${pages}`;
}
function renderDashboard(){
  const count=(fn)=>state.equipamentos.filter(fn).length;
  $("kpiTotal").textContent=state.equipamentos.length;
  $("kpiTablets").textContent=count(e=>e.tipo==="Tablet");
  $("kpiNotebooks").textContent=count(e=>e.tipo==="Notebook");
  $("kpiComputadores").textContent=count(e=>e.tipo==="Computador");
  $("kpiSmartphones").textContent=count(e=>e.tipo==="Smartphone");
  makeBars("tipoBars", groupBy(state.equipamentos,"tipo"));
  makeBars("localBars", Object.fromEntries(Object.entries(groupBy(state.equipamentos,"local")).sort((a,b)=>b[1]-a[1]).slice(0,8)));
}
function groupBy(arr,key){ return arr.reduce((acc,e)=>{ const k=e[key]||"Não informado"; acc[k]=(acc[k]||0)+1; return acc; },{}); }
function makeBars(id,data){ const max=Math.max(1,...Object.values(data)); $(id).innerHTML=Object.entries(data).map(([k,v])=>`<div class="bar-row"><span>${esc(k)}</span><div class="bar-bg"><div class="bar-fill" style="width:${Math.round(v/max*100)}%"></div></div><b>${v}</b></div>`).join("");}
function getFormData(){
  return ["tipo","categoria","modelo","numeroSerie","patrimonio","imei","hostname","local","etiqueta","responsavel","status","origem","observacao"]
    .reduce((o,id)=>{o[id]=$(id).value.trim(); return o;},{});
}
function setFormData(e={}){
  ["tipo","categoria","modelo","numeroSerie","patrimonio","imei","hostname","local","etiqueta","responsavel","status","origem","observacao"].forEach(id=>$(id).value=e[id]||"");
  $("tipo").value=e.tipo||"Tablet"; $("status").value=e.status||"Ativo"; $("editId").value=e.id||"";
  $("formTitle").textContent=e.id?"Editar equipamento":"Novo equipamento";
}
async function saveEquip(e){
  e.preventDefault();
  const data=getFormData(); const id=$("editId").value;
  try{
    if(id){
      const old=state.equipamentos.find(x=>x.id===id)||{};
      await updateDoc(doc(state.db,"equipamentos",id), {...data, atualizadoEm:serverTimestamp()});
      await logMov(id, data, old);
      toast("Equipamento atualizado");
    } else {
      await addDoc(collection(state.db,"equipamentos"), {...data, criadoEm:serverTimestamp(), atualizadoEm:serverTimestamp()});
      toast("Equipamento cadastrado");
    }
    setFormData(); await loadEquipamentos(); showView("equipamentos");
  }catch(err){ toast("Erro ao salvar: "+errorText(err)); }
}
async function logMov(id, data, old){
  const changes=[];
  ["local","responsavel","status","patrimonio","hostname"].forEach(k=>{ if((old[k]||"") !== (data[k]||"")) changes.push(`${k}: "${old[k]||""}" → "${data[k]||""}"`); });
  if(changes.length) await addDoc(collection(state.db,"movimentacoes"), {equipamentoId:id, patrimonio:data.patrimonio||"", serie:data.numeroSerie||data.imei||"", alteracoes:changes, usuario:state.user?.email||"", data:serverTimestamp()});
}
async function loadHistory(){
  try{
    const q=query(collection(state.db,"movimentacoes"), orderBy("data","desc"), limit(30));
    const snap=await getDocs(q);
    $("historyList").innerHTML = snap.docs.map(d=>{ const h=d.data(); return `<div class="history-item"><strong>${esc(h.patrimonio||h.serie||"Equipamento")}</strong><br><small>${esc(h.usuario||"")}</small><br>${(h.alteracoes||[]).map(esc).join("<br>")}</div>`; }).join("") || "<p>Nenhuma movimentação registrada ainda.</p>";
  } catch(e){ $("historyList").innerHTML="<p>Histórico indisponível.</p>"; }
}
async function seedInitial(){
  if(!confirm("Enviar os dados iniciais das planilhas para o Firebase? Use apenas uma vez.")) return;
  try{
    const existing=state.equipamentos.length;
    if(existing && !confirm(`Já existem ${existing} equipamentos. Deseja continuar mesmo assim?`)) return;
    const dados=window.DADOS_INICIAIS||[];
    for(let i=0;i<dados.length;i+=450){
      const batch=writeBatch(state.db);
      dados.slice(i,i+450).forEach(item=>{
        const ref=doc(collection(state.db,"equipamentos"));
        const {id,...data}=item;
        batch.set(ref,{...data, criadoEm:serverTimestamp(), atualizadoEm:serverTimestamp()});
      });
      await batch.commit();
    }
    toast("Dados iniciais enviados");
    await loadEquipamentos();
  }catch(e){ toast("Erro ao enviar dados: "+errorText(e)); }
}
function exportCSV(){
  const headers=["tipo","categoria","modelo","numeroSerie","patrimonio","imei","hostname","local","etiqueta","responsavel","status","origem","observacao"];
  const lines=[headers.join(";")].concat(state.filtered.map(e=>headers.map(h=>`"${String(e[h]||"").replaceAll('"','""')}"`).join(";")));
  download("inventario_sesi.csv", "\ufeff"+lines.join("\n"), "text/csv;charset=utf-8");
}
function backupJSON(){ download("backup_inventario_sesi.json", JSON.stringify(state.equipamentos,null,2), "application/json"); }
async function importJSON(file){
  const text=await file.text(); const arr=JSON.parse(text);
  if(!Array.isArray(arr)) throw new Error("Arquivo inválido");
  if(!confirm(`Importar ${arr.length} equipamentos para o Firebase?`)) return;
  for(let i=0;i<arr.length;i+=450){
    const batch=writeBatch(state.db);
    arr.slice(i,i+450).forEach(item=>{ const ref=doc(collection(state.db,"equipamentos")); const {id,...data}=item; batch.set(ref,{...data, atualizadoEm:serverTimestamp()}); });
    await batch.commit();
  }
  await loadEquipamentos(); toast("Backup importado");
}
async function deleteAll(){
  if(!confirm("Apagar TODOS os equipamentos do Firebase?")) return;
  if(!confirm("Confirma novamente? Essa ação não tem volta.")) return;
  const snap=await getDocs(collection(state.db,"equipamentos"));
  for(let i=0;i<snap.docs.length;i+=450){ const batch=writeBatch(state.db); snap.docs.slice(i,i+450).forEach(d=>batch.delete(d.ref)); await batch.commit(); }
  await loadEquipamentos(); toast("Todos os equipamentos foram apagados");
}
function download(name, content, type){ const blob=new Blob([content],{type}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function showView(view){
  document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
  $(`view-${view}`).classList.remove("hidden");
  document.querySelectorAll(".sidebar nav a").forEach(a=>a.classList.toggle("active", a.dataset.view===view));
  $("pageTitle").textContent = {dashboard:"Dashboard", equipamentos:"Equipamentos", cadastro:"Cadastro", movimentacoes:"Movimentações", config:"Configurações"}[view];
}
function esc(s){ return String(s??"").replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])); }
function pillClass(s){ return String(s||"Ativo").split(" ")[0]; }

document.addEventListener("click", async (e)=>{
  const edit=e.target.dataset?.edit, del=e.target.dataset?.del;
  if(edit){ const item=state.equipamentos.find(x=>x.id===edit); setFormData(item); showView("cadastro"); }
  if(del && confirm("Excluir este equipamento?")){ await deleteDoc(doc(state.db,"equipamentos",del)); await loadEquipamentos(); toast("Equipamento excluído"); }
});
document.querySelectorAll(".sidebar nav a").forEach(a=>a.addEventListener("click",ev=>{ev.preventDefault(); showView(a.dataset.view);}));
$("loginBtn").onclick=login; $("createUserBtn").onclick=createUser; $("logoutBtn").onclick=()=>signOut(state.auth);
$("equipForm").onsubmit=saveEquip; $("clearFormBtn").onclick=()=>setFormData();
$("openNewBtn").onclick=()=>{setFormData(); showView("cadastro");};
$("seedBtn").onclick=seedInitial; $("exportBtn").onclick=exportCSV; $("backupJsonBtn").onclick=backupJSON; $("deleteAllBtn").onclick=deleteAll;
$("importJsonInput").onchange=(e)=>e.target.files[0]&&importJSON(e.target.files[0]).catch(err=>toast("Erro ao importar: "+errorText(err)));
["searchInput","filterTipo","filterStatus","filterLocal"].forEach(id=>$(id)?.addEventListener("input",applyFilters));
$("prevPage").onclick=()=>{state.page=Math.max(1,state.page-1);renderTable();};
$("nextPage").onclick=()=>{state.page+=1;renderTable();};
initFirebase();
