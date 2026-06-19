import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, setDoc, updateDoc, deleteDoc, getDocs, writeBatch, serverTimestamp, query, orderBy, limit, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const state = { app:null, auth:null, db:null, equipamentos:[], filtered:[], page:1, perPage:25, user:null, perfil:null, usuarios:[], qrScanner:null, scannerRunning:false, pendingHash:null };
const ROLES = { admin:"Administrador", tecnico:"Técnico TI", consulta:"Consulta" };
const canAdmin = () => state.perfil?.nivel === "admin";
const canEdit = () => ["admin","tecnico"].includes(state.perfil?.nivel);

function toast(msg){ const t=$("toast"); t.textContent=msg; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),3000); }
function errorText(e){ return e?.message || e?.code || String(e) || "Erro desconhecido"; }
function validConfig(){ const c = window.firebaseConfig || {}; return c.apiKey && !c.apiKey.includes("COLE_") && c.projectId && c.projectId !== "SEU_PROJETO"; }
function initFirebase(){
  if(!validConfig()){ $("configNotice").innerHTML = "⚠️ Configure o arquivo <b>firebase-config.js</b> antes de usar."; $("loginMsg").textContent = "Firebase ainda não configurado."; return false; }
  try{
    state.app = initializeApp(window.firebaseConfig);
    state.auth = getAuth(state.app);
    state.db = getFirestore(state.app);
    $("configNotice").textContent = "Firebase configurado. Faça login ou crie o primeiro usuário.";
    onAuthStateChanged(state.auth, async (user)=>{
      state.user = user;
      if(user){
        $("loginScreen").classList.add("hidden"); $("appScreen").classList.remove("hidden");
        await ensureUserProfile(user);
        applyPermissions();
        await loadEquipamentos(); await loadHistory(); if(canAdmin()) await loadUsers(); handleHashNavigation();
      } else { $("loginScreen").classList.remove("hidden"); $("appScreen").classList.add("hidden"); }
    });
    return true;
  }catch(e){ $("loginMsg").textContent = "Erro na configuração Firebase: " + errorText(e); return false; }
}
async function ensureUserProfile(user){
  const usersSnap = await getDocs(collection(state.db,"usuarios"));
  const ref = doc(state.db,"usuarios",user.uid);
  const my = await getDoc(ref);
  if(!my.exists()){
    const nivel = usersSnap.empty ? "admin" : "consulta";
    await setDoc(ref,{ email:user.email, nivel, nome:user.email, criadoEm:serverTimestamp(), atualizadoEm:serverTimestamp() });
    state.perfil = { id:user.uid, email:user.email, nivel, nome:user.email };
    toast(nivel === "admin" ? "Primeiro usuário definido como Administrador" : "Usuário criado como Consulta. Peça liberação ao administrador.");
  } else state.perfil = { id:user.uid, ...my.data() };
  $("userInfo").textContent = `${user.email} · ${ROLES[state.perfil.nivel]||"Consulta"}`;
  $("sideEmail").textContent = user.email;
  $("sideRole").textContent = ROLES[state.perfil.nivel] || "Consulta";
}
function applyPermissions(){
  document.querySelectorAll("[data-admin-only]").forEach(el=>el.classList.toggle("hidden", !canAdmin()));
  document.querySelectorAll("[data-admin-action]").forEach(el=>el.classList.toggle("hidden", !canAdmin()));
  document.querySelectorAll("[data-edit-only]").forEach(el=>el.classList.toggle("hidden", !canEdit()));
  document.querySelectorAll("[data-edit-action]").forEach(el=>el.classList.toggle("hidden", !canEdit()));
}
async function login(){ $("loginMsg").textContent=""; if(!state.auth){ $("loginMsg").textContent="Firebase não carregou. Confira firebase-config.js e atualize com Ctrl+F5."; return; } try{ await signInWithEmailAndPassword(state.auth, $("email").value.trim(), $("password").value); } catch(e){ $("loginMsg").textContent = "Erro ao entrar: " + errorText(e); } }
async function createUser(){ $("loginMsg").textContent=""; if(!state.auth){ $("loginMsg").textContent="Firebase não carregou. Confira firebase-config.js e atualize com Ctrl+F5."; return; } try{ await createUserWithEmailAndPassword(state.auth, $("email").value.trim(), $("password").value); toast("Usuário criado com sucesso"); } catch(e){ $("loginMsg").textContent = "Erro ao criar usuário: " + errorText(e); } }
async function loadEquipamentos(){ const snap = await getDocs(collection(state.db, "equipamentos")); state.equipamentos = snap.docs.map(d=>({id:d.id, ...d.data()})); state.equipamentos.sort((a,b)=>(a.tipo||"").localeCompare(b.tipo||"") || (a.local||"").localeCompare(b.local||"")); fillFilters(); applyFilters(); renderDashboard(); }
function fillFilters(){
  fillSelect("filterTipo", uniqueValues("tipo"));
  fillSelect("filterStatus", uniqueValues("status"));
  fillSelect("filterLocal", uniqueValues("local"));
  fillDatalist("listaCategoria", uniqueValues("categoria"));
  fillDatalist("listaModelo", uniqueValues("modelo"));
  fillDatalist("listaLocal", uniqueValues("local"));
  fillDatalist("listaEtiqueta", uniqueValues("etiqueta"));
  fillDatalist("listaResponsavel", uniqueValues("responsavel"));
  fillDatalist("listaStatus", uniqueValues("status", ["Ativo","Reserva","Em manutenção","Baixado","Emprestado"]));
  fillDatalist("listaOrigem", uniqueValues("origem"));
}
function uniqueValues(key, base=[]){ return [...new Set([...(base||[]), ...state.equipamentos.map(x=>x[key]).filter(Boolean)])].sort((a,b)=>String(a).localeCompare(String(b),'pt-BR')); }
function fillDatalist(id, values){ const el=$(id); if(!el) return; el.innerHTML = values.map(v=>`<option value="${esc(v)}"></option>`).join(""); }
function fillSelect(id, values){ const el=$(id), current=el.value, first=el.options[0].textContent; el.innerHTML = `<option value="">${first}</option>` + values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join(""); el.value = current; }
function applyFilters(){ const term = $("searchInput")?.value?.toLowerCase() || ""; const tipo = $("filterTipo")?.value || "", status = $("filterStatus")?.value || "", local = $("filterLocal")?.value || ""; state.filtered = state.equipamentos.filter(e=>{ const blob = Object.values(e).join(" ").toLowerCase(); return (!term || blob.includes(term)) && (!tipo || e.tipo===tipo) && (!status || e.status===status) && (!local || e.local===local); }); state.page=1; renderTable(); }
function renderTable(){
  const total=state.filtered.length, pages=Math.max(1, Math.ceil(total/state.perPage)); state.page=Math.min(state.page,pages); const rows=state.filtered.slice((state.page-1)*state.perPage, state.page*state.perPage);
  $("equipTable").innerHTML = rows.map(e=>`<tr><td>${esc(e.tipo)}</td><td>${esc(e.modelo||e.categoria)}</td><td>${esc(e.numeroSerie||e.imei)}</td><td>${esc(e.patrimonio)}</td><td>${esc(e.hostname)}</td><td>${esc(e.local)}</td><td>${esc(e.responsavel)}</td><td><span class="pill ${pillClass(e.status)}">${esc(e.status||"Ativo")}</span></td><td><button class="btn small secondary" data-edit="${e.id}">Ver/Editar</button> <button class="btn small secondary" data-copy-qr="${e.id}">Copiar QR</button> ${canAdmin()?`<button class="btn small danger" data-del="${e.id}">Excluir</button>`:""}</td></tr>`).join("");
  $("resultCount").textContent = `${total} itens`; $("pageInfo").textContent = `${state.page} / ${pages}`;
}
function renderDashboard(){ const count=(fn)=>state.equipamentos.filter(fn).length; $("kpiTotal").textContent=state.equipamentos.length; $("kpiTablets").textContent=count(e=>e.tipo==="Tablet"); $("kpiNotebooks").textContent=count(e=>e.tipo==="Notebook"); $("kpiComputadores").textContent=count(e=>e.tipo==="Computador"); $("kpiSmartphones").textContent=count(e=>e.tipo==="Smartphone"); $("kpiManutencao").textContent=count(e=>e.status==="Em manutenção"); $("kpiReserva").textContent=count(e=>e.status==="Reserva"); $("kpiBaixados").textContent=count(e=>e.status==="Baixado"); makeBars("tipoBars", groupBy(state.equipamentos,"tipo")); makeBars("localBars", Object.fromEntries(Object.entries(groupBy(state.equipamentos,"local")).sort((a,b)=>b[1]-a[1]).slice(0,8))); }
function groupBy(arr,key){ return arr.reduce((acc,e)=>{ const k=e[key]||"Não informado"; acc[k]=(acc[k]||0)+1; return acc; },{}); }
function makeBars(id,data){ const max=Math.max(1,...Object.values(data)); $(id).innerHTML=Object.entries(data).map(([k,v])=>`<div class="bar-row"><span>${esc(k)}</span><div class="bar-bg"><div class="bar-fill" style="width:${Math.round(v/max*100)}%"></div></div><b>${v}</b></div>`).join("") || "<p>Nenhum dado ainda.</p>";}
function getFormData(){ return ["tipo","categoria","modelo","numeroSerie","patrimonio","imei","hostname","local","etiqueta","responsavel","status","origem","fotoUrl","observacao"].reduce((o,id)=>{o[id]=$(id).value.trim(); return o;},{}); }
function setFormData(e={}){ ["tipo","categoria","modelo","numeroSerie","patrimonio","imei","hostname","local","etiqueta","responsavel","status","origem","fotoUrl","observacao"].forEach(id=>$(id).value=e[id]||""); $("tipo").value=e.tipo||"Tablet"; $("status").value=e.status||"Ativo"; $("editId").value=e.id||""; $("formTitle").textContent=e.id?"Editar equipamento":"Novo equipamento"; renderPhotoAndQr(e); document.querySelectorAll("#equipForm input,#equipForm select,#equipForm textarea,#equipForm button[type='submit']").forEach(el=>{ if(el.id!=="clearFormBtn") el.disabled=!canEdit(); }); }
function renderPhotoAndQr(e={}){ const img=$("photoPreview"), qr=$("qrBox"); if(e.fotoUrl){ img.src=e.fotoUrl; img.classList.remove("hidden"); } else { img.removeAttribute("src"); img.classList.add("hidden"); } const code=e.patrimonio || e.numeroSerie || e.imei || e.hostname; if(code){ const text=encodeURIComponent(`Inventário SESI\nPatrimônio: ${e.patrimonio||""}\nSérie/IMEI: ${e.numeroSerie||e.imei||""}\nLocal: ${e.local||""}`); qr.innerHTML=`<img alt="QR Code" src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${text}"><small>QR Code do equipamento</small>`; qr.classList.remove("hidden"); } else qr.classList.add("hidden"); }
async function saveEquip(e){
  e.preventDefault(); if(!canEdit()){ toast("Seu usuário é somente consulta."); return; }
  const data=getFormData(); const id=$("editId").value;
  try{ if(id){ const old=state.equipamentos.find(x=>x.id===id)||{}; await updateDoc(doc(state.db,"equipamentos",id), {...data, atualizadoEm:serverTimestamp(), atualizadoPor:state.user?.email||""}); await logMov(id, data, old, "Atualização"); toast("Equipamento atualizado"); } else { const ref=await addDoc(collection(state.db,"equipamentos"), {...data, criadoEm:serverTimestamp(), atualizadoEm:serverTimestamp(), criadoPor:state.user?.email||"", atualizadoPor:state.user?.email||""}); await addDoc(collection(state.db,"movimentacoes"), {equipamentoId:ref.id, patrimonio:data.patrimonio||"", serie:data.numeroSerie||data.imei||"", acao:"Cadastro", alteracoes:["Equipamento cadastrado"], usuario:state.user?.email||"", data:serverTimestamp()}); toast("Equipamento cadastrado"); } setFormData(); await loadEquipamentos(); await loadHistory(); showView("equipamentos"); } catch(err){ toast("Erro ao salvar: "+errorText(err)); }
}
async function logMov(id, data, old, acao){ const changes=[]; ["local","responsavel","status","patrimonio","hostname","modelo","numeroSerie","imei","fotoUrl"].forEach(k=>{ if((old[k]||"") !== (data[k]||"")) changes.push(`${k}: "${old[k]||""}" → "${data[k]||""}"`); }); if(changes.length) await addDoc(collection(state.db,"movimentacoes"), {equipamentoId:id, patrimonio:data.patrimonio||"", serie:data.numeroSerie||data.imei||"", acao, alteracoes:changes, usuario:state.user?.email||"", data:serverTimestamp()}); }
async function loadHistory(){ try{ const q=query(collection(state.db,"movimentacoes"), orderBy("data","desc"), limit(60)); const snap=await getDocs(q); $("historyList").innerHTML = snap.docs.map(d=>{ const h=d.data(); const dt=h.data?.toDate ? h.data.toDate().toLocaleString("pt-BR") : ""; return `<div class="history-item"><strong>${esc(h.acao||"Alteração")} · ${esc(h.patrimonio||h.serie||"Equipamento")}</strong><br><small>${esc(dt)} · ${esc(h.usuario||"")}</small><br>${(h.alteracoes||[]).map(esc).join("<br>")}</div>`; }).join("") || "<p>Nenhuma movimentação registrada ainda.</p>"; } catch(e){ $("historyList").innerHTML="<p>Histórico indisponível. Confira as regras do Firestore.</p>"; } }
async function seedInitial(){ if(!canAdmin()) return toast("Apenas administrador."); if(!confirm("Enviar os dados iniciais das planilhas para o Firebase? Use apenas uma vez.")) return; try{ const existing=state.equipamentos.length; if(existing && !confirm(`Já existem ${existing} equipamentos. Deseja continuar mesmo assim?`)) return; const dados=window.DADOS_INICIAIS||[]; for(let i=0;i<dados.length;i+=450){ const batch=writeBatch(state.db); dados.slice(i,i+450).forEach(item=>{ const ref=doc(collection(state.db,"equipamentos")); const {id,...data}=item; batch.set(ref,{...data, criadoEm:serverTimestamp(), atualizadoEm:serverTimestamp(), criadoPor:state.user?.email||""}); }); await batch.commit(); } await addDoc(collection(state.db,"movimentacoes"), {acao:"Importação", alteracoes:[`Importados ${dados.length} equipamentos iniciais`], usuario:state.user?.email||"", data:serverTimestamp()}); toast("Dados iniciais enviados"); await loadEquipamentos(); await loadHistory(); }catch(e){ toast("Erro ao enviar dados: "+errorText(e)); } }
function exportCSV(){ const headers=["tipo","categoria","modelo","numeroSerie","patrimonio","imei","hostname","local","etiqueta","responsavel","status","origem","fotoUrl","observacao"]; const lines=[headers.join(";")].concat(state.filtered.map(e=>headers.map(h=>`"${String(e[h]||"").replaceAll('"','""')}"`).join(";"))); download("inventario_sesi.csv", "\ufeff"+lines.join("\n"), "text/csv;charset=utf-8"); }
function backupJSON(){ download("backup_inventario_sesi.json", JSON.stringify(state.equipamentos,null,2), "application/json"); }
async function importJSON(file){ if(!canAdmin()) return toast("Apenas administrador."); const text=await file.text(); const arr=JSON.parse(text); if(!Array.isArray(arr)) throw new Error("Arquivo inválido"); if(!confirm(`Importar ${arr.length} equipamentos para o Firebase?`)) return; for(let i=0;i<arr.length;i+=450){ const batch=writeBatch(state.db); arr.slice(i,i+450).forEach(item=>{ const ref=doc(collection(state.db,"equipamentos")); const {id,...data}=item; batch.set(ref,{...data, atualizadoEm:serverTimestamp(), atualizadoPor:state.user?.email||""}); }); await batch.commit(); } await loadEquipamentos(); toast("Backup importado"); }
async function deleteAll(){ if(!canAdmin()) return toast("Apenas administrador."); if(!confirm("Apagar TODOS os equipamentos do Firebase?")) return; if(!confirm("Confirma novamente? Essa ação não tem volta.")) return; const snap=await getDocs(collection(state.db,"equipamentos")); for(let i=0;i<snap.docs.length;i+=450){ const batch=writeBatch(state.db); snap.docs.slice(i,i+450).forEach(d=>batch.delete(d.ref)); await batch.commit(); } await addDoc(collection(state.db,"movimentacoes"), {acao:"Exclusão geral", alteracoes:["Todos os equipamentos foram apagados"], usuario:state.user?.email||"", data:serverTimestamp()}); await loadEquipamentos(); toast("Todos os equipamentos foram apagados"); }
async function loadUsers(){ const snap=await getDocs(collection(state.db,"usuarios")); state.usuarios=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.email||"").localeCompare(b.email||"")); renderUsers(); }
function renderUsers(){ $("usersList").innerHTML = state.usuarios.map(u=>`<div class="user-row"><div><b>${esc(u.nome||u.email)}</b><small>${esc(u.email||"")}</small></div><select data-role-user="${u.id}"><option value="admin" ${u.nivel==="admin"?"selected":""}>Administrador</option><option value="tecnico" ${u.nivel==="tecnico"?"selected":""}>Técnico TI</option><option value="consulta" ${!u.nivel||u.nivel==="consulta"?"selected":""}>Consulta</option></select><button class="btn secondary small" data-save-role="${u.id}">Salvar</button></div>`).join("") || "<p>Nenhum usuário encontrado.</p>"; }
async function saveRole(uid){ if(!canAdmin()) return; const sel=document.querySelector(`[data-role-user="${uid}"]`); await updateDoc(doc(state.db,"usuarios",uid), {nivel:sel.value, atualizadoEm:serverTimestamp(), atualizadoPor:state.user?.email||""}); toast("Permissão atualizada"); await loadUsers(); }
function download(name, content, type){ const blob=new Blob([content],{type}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function showView(view){
  if((view==="usuarios"||view==="config"||view==="importacao")&&!canAdmin()) return toast("Apenas administrador.");
  if(view==="cadastro"&&!canEdit()&&!$("editId").value) return toast("Seu usuário é somente consulta.");
  if(state.scannerRunning && view!=="scanner") stopScanner();
  document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
  $(`view-${view}`).classList.remove("hidden");
  document.querySelectorAll(".sidebar nav a").forEach(a=>a.classList.toggle("active", a.dataset.view===view));
  $("pageTitle").textContent = {dashboard:"Dashboard", equipamentos:"Equipamentos", cadastro:"Cadastro", importacao:"Importar Excel", scanner:"Escanear QR", movimentacoes:"Histórico", usuarios:"Usuários", config:"Configurações"}[view];
  if(view==="usuarios") loadUsers();
}
function esc(s){ return String(s??"").replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])); }
function pillClass(s){ return String(s||"Ativo").split(" ")[0]; }
async function compressImage(file){ return new Promise((resolve,reject)=>{ const reader=new FileReader(); reader.onload=()=>{ const img=new Image(); img.onload=()=>{ const canvas=document.createElement("canvas"); const max=900; let w=img.width,h=img.height; if(w>h && w>max){h=Math.round(h*max/w); w=max;} else if(h>max){w=Math.round(w*max/h); h=max;} canvas.width=w; canvas.height=h; canvas.getContext("2d").drawImage(img,0,0,w,h); resolve(canvas.toDataURL("image/jpeg",.78)); }; img.onerror=reject; img.src=reader.result; }; reader.onerror=reject; reader.readAsDataURL(file); }); }


function openEquipamento(item){
  if(!item){ toast("Equipamento não encontrado."); return; }
  setFormData(item);
  history.replaceState(null, "", `#equipamento=${encodeURIComponent(item.id)}`);
  showView("cadastro");
}
function findEquipamentoByCode(raw){
  const text=String(raw||"").trim();
  if(!text) return null;
  let code=text;
  try{
    const url=new URL(text);
    const hash=url.hash || "";
    const params=new URLSearchParams(hash.replace(/^#/,""));
    if(params.get("equipamento")) return state.equipamentos.find(e=>e.id===params.get("equipamento"));
    code=params.get("buscar") || url.searchParams.get("equipamento") || url.searchParams.get("buscar") || text;
  }catch(_){
    const params=new URLSearchParams(text.replace(/^#/,""));
    code=params.get("equipamento") || params.get("buscar") || text;
    const byId=state.equipamentos.find(e=>e.id===code); if(byId) return byId;
  }
  const n=normalize(code);
  return state.equipamentos.find(e=>[e.patrimonio,e.numeroSerie,e.imei,e.hostname,e.etiqueta].some(v=>normalize(v)===n || (n && normalize(v).includes(n))));
}
function normalize(v){ return String(v||"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,""); }
function handleHashNavigation(){
  if(!location.hash) return;
  const params=new URLSearchParams(location.hash.replace(/^#/,""));
  const id=params.get("equipamento"), buscar=params.get("buscar");
  let item = id ? state.equipamentos.find(e=>e.id===id) : null;
  if(!item && buscar) item=findEquipamentoByCode(buscar);
  if(item) openEquipamento(item);
}
async function copyToClipboard(text){ try{ await navigator.clipboard.writeText(text); toast("Link do QR copiado"); }catch(_){ prompt("Copie o link:", text); } }
async function startScanner(){
  if(state.scannerRunning) return;
  if(!window.Html5Qrcode){ $("scannerMsg").textContent="Leitor de QR não carregou. Atualize a página."; return; }
  try{
    state.qrScanner = state.qrScanner || new Html5Qrcode("qrReader");
    await state.qrScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, async (decodedText)=>{
      $("scannerMsg").textContent = "QR Code lido. Buscando equipamento...";
      await stopScanner();
      openFromQr(decodedText);
    });
    state.scannerRunning=true;
    $("scannerMsg").textContent="Câmera ativa. Aponte para o QR Code.";
  }catch(e){ $("scannerMsg").textContent="Não foi possível abrir a câmera: "+errorText(e); }
}
async function stopScanner(){
  try{ if(state.qrScanner && state.scannerRunning){ await state.qrScanner.stop(); await state.qrScanner.clear(); } }catch(_){ }
  state.scannerRunning=false;
}
function openFromQr(text){
  const item=findEquipamentoByCode(text);
  if(item) openEquipamento(item); else { showView("equipamentos"); $("searchInput").value=String(text||"").slice(0,80); applyFilters(); toast("QR lido, mas equipamento não encontrado. A busca foi preenchida."); }
}
function parseExcelRows(rows, filename="planilha"){
  const mapKey=(k)=>normalize(k).replace(/[^a-z0-9]/g,"");
  const aliases={
    tipo:["tipo","equipamento","classe"], categoria:["categoria","setor","grupo"], modelo:["modelo","model"], numeroSerie:["numerodeserie","nserie","serie","serial","serialnumber","s/n","sn"], patrimonio:["patrimonio","patrimônio","npatrimonio","numpatrimonio","numero patrimonio"], imei:["imei"], hostname:["hostname","nomecomputador","computador","nome"], local:["local","sala","ambiente","localizacao","localização"], etiqueta:["etiqueta","identificacao","identificação","tag"], responsavel:["responsavel","responsável","usuario","usuário","colaborador"], status:["status","situacao","situação","estado"], origem:["origem","planilha"], observacao:["observacao","observação","obs","observacoes","observações"]
  };
  const findValue=(row, field)=>{
    const entries=Object.entries(row);
    for(const alias of aliases[field]){
      const wanted=mapKey(alias);
      const found=entries.find(([k])=>mapKey(k)===wanted || mapKey(k).includes(wanted));
      if(found && String(found[1]??"").trim()) return String(found[1]).trim();
    }
    return "";
  };
  return rows.map(row=>({
    tipo:findValue(row,"tipo")||"Outro", categoria:findValue(row,"categoria"), modelo:findValue(row,"modelo"), numeroSerie:findValue(row,"numeroSerie"), patrimonio:findValue(row,"patrimonio"), imei:findValue(row,"imei"), hostname:findValue(row,"hostname"), local:findValue(row,"local"), etiqueta:findValue(row,"etiqueta"), responsavel:findValue(row,"responsavel"), status:findValue(row,"status")||"Ativo", origem:findValue(row,"origem")||filename, observacao:findValue(row,"observacao")
  })).filter(e=>Object.values(e).some(v=>String(v||"").trim()));
}
async function importExcel(file){
  if(!canAdmin()) return toast("Apenas administrador.");
  if(!window.XLSX) return toast("Biblioteca de Excel não carregou. Atualize a página.");
  const status=$("importExcelStatus"); status.textContent="Lendo planilha...";
  const buffer=await file.arrayBuffer();
  const wb=XLSX.read(buffer,{type:"array"});
  let all=[];
  wb.SheetNames.forEach(name=>{
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{defval:""});
    all=all.concat(parseExcelRows(rows, `${file.name} / ${name}`));
  });
  if(!all.length){ status.textContent="Nenhum equipamento encontrado na planilha."; return; }
  const existentes=new Set(state.equipamentos.flatMap(e=>[e.patrimonio,e.numeroSerie,e.imei].filter(Boolean).map(normalize)));
  const duplicados=all.filter(e=>[e.patrimonio,e.numeroSerie,e.imei].some(v=>existentes.has(normalize(v)))).length;
  if(!confirm(`Foram encontrados ${all.length} equipamentos. ${duplicados} parecem já existir. Deseja importar mesmo assim?`)){ status.textContent="Importação cancelada."; return; }
  let enviados=0;
  for(let i=0;i<all.length;i+=450){
    const batch=writeBatch(state.db);
    all.slice(i,i+450).forEach(item=>{ const ref=doc(collection(state.db,"equipamentos")); batch.set(ref,{...item, criadoEm:serverTimestamp(), atualizadoEm:serverTimestamp(), criadoPor:state.user?.email||"", atualizadoPor:state.user?.email||""}); });
    await batch.commit(); enviados += all.slice(i,i+450).length; status.textContent=`Importando... ${enviados}/${all.length}`;
  }
  await addDoc(collection(state.db,"movimentacoes"), {acao:"Importação Excel", alteracoes:[`Importados ${all.length} equipamentos de ${file.name}`], usuario:state.user?.email||"", data:serverTimestamp()});
  await loadEquipamentos(); await loadHistory(); status.textContent=`Importação concluída: ${all.length} equipamentos enviados.`; toast("Excel importado com sucesso");
}
function downloadModeloCSV(){
  const headers=["tipo","categoria","modelo","numeroSerie","patrimonio","imei","hostname","local","etiqueta","responsavel","status","origem","observacao"];
  download("modelo_importacao_inventario.csv", "﻿"+headers.join(";")+"
Notebook;ADM;Dell Latitude;ABC123;12345;;NOTE-001;TI;Etiqueta 01;Alan;Ativo;Importação;", "text/csv;charset=utf-8");
}

document.addEventListener("click", async (e)=>{
  const edit=e.target.dataset?.edit, del=e.target.dataset?.del, saveRoleId=e.target.dataset?.saveRole, copyQr=e.target.dataset?.copyQr, copyLink=e.target.dataset?.copyLink;
  if(edit){ const item=state.equipamentos.find(x=>x.id===edit); openEquipamento(item); }
  if(copyQr){ const item=state.equipamentos.find(x=>x.id===copyQr); if(item) await copyToClipboard(equipamentoUrl(item)); }
  if(copyLink){ await copyToClipboard(copyLink); }
  if(del && canAdmin() && confirm("Excluir este equipamento?")){ const item=state.equipamentos.find(x=>x.id===del)||{}; await deleteDoc(doc(state.db,"equipamentos",del)); await addDoc(collection(state.db,"movimentacoes"), {equipamentoId:del, patrimonio:item.patrimonio||"", serie:item.numeroSerie||item.imei||"", acao:"Exclusão", alteracoes:["Equipamento excluído"], usuario:state.user?.email||"", data:serverTimestamp()}); await loadEquipamentos(); await loadHistory(); toast("Equipamento excluído"); }
  if(saveRoleId) await saveRole(saveRoleId);
});
document.querySelectorAll(".sidebar nav a").forEach(a=>a.addEventListener("click",ev=>{ev.preventDefault(); showView(a.dataset.view);}));
$("loginBtn").onclick=login; $("createUserBtn").onclick=createUser; $("logoutBtn").onclick=()=>signOut(state.auth);
$("equipForm").onsubmit=saveEquip; $("clearFormBtn").onclick=()=>setFormData(); $("openNewBtn").onclick=()=>{setFormData(); showView("cadastro");};
$("seedBtn").onclick=seedInitial; $("exportBtn").onclick=exportCSV; $("backupJsonBtn").onclick=backupJSON; $("deleteAllBtn").onclick=deleteAll; $("downloadModeloExcelBtn").onclick=downloadModeloCSV; $("startScannerBtn").onclick=startScanner; $("stopScannerBtn").onclick=stopScanner; $("manualQrBtn").onclick=()=>openFromQr($("manualQrInput").value);
$("importJsonInput").onchange=(e)=>e.target.files[0]&&importJSON(e.target.files[0]).catch(err=>toast("Erro ao importar: "+errorText(err)));
$("importExcelInput").onchange=(e)=>e.target.files[0]&&importExcel(e.target.files[0]).catch(err=>{ $("importExcelStatus").textContent="Erro ao importar: "+errorText(err); toast("Erro ao importar Excel"); });
$("fotoInput").onchange=async(e)=>{ const file=e.target.files?.[0]; if(!file) return; try{ $("fotoUrl").value=await compressImage(file); renderPhotoAndQr(getFormData()); toast("Foto carregada no cadastro"); }catch(err){ toast("Erro ao carregar foto: "+errorText(err)); } };
$("fotoUrl").addEventListener("input",()=>renderPhotoAndQr(getFormData()));
["searchInput","filterTipo","filterStatus","filterLocal"].forEach(id=>$(id)?.addEventListener("input",applyFilters));
$("prevPage").onclick=()=>{state.page=Math.max(1,state.page-1);renderTable();}; $("nextPage").onclick=()=>{state.page+=1;renderTable();};
window.addEventListener("hashchange", handleHashNavigation);
initFirebase();
