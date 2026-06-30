import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, setDoc, updateDoc, deleteDoc, getDocs, writeBatch, serverTimestamp, query, orderBy, limit, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const state = { app:null, auth:null, db:null, equipamentos:[], filtered:[], page:1, perPage:25, user:null, perfil:null, usuarios:[], qrScanner:null, pendingEquipId:null, currentDetailId:null };
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
        await loadEquipamentos(); await loadHistory(); if(canAdmin()) await loadUsers();
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
async function loadEquipamentos(){ const snap = await getDocs(collection(state.db, "equipamentos")); state.equipamentos = snap.docs.map(d=>({id:d.id, ...d.data()})); state.equipamentos.sort((a,b)=>(a.tipo||"").localeCompare(b.tipo||"") || (a.local||"").localeCompare(b.local||"")); fillFilters(); fillSmartLists(); populateBulkStatusControls(); populateQrPdfControls(); applyFilters(); renderDashboard(); openEquipmentFromUrlIfNeeded(); }
function fillFilters(){ fillSelect("filterTipo", [...new Set(state.equipamentos.map(x=>x.tipo).filter(Boolean))].sort()); fillSelect("filterStatus", [...new Set(state.equipamentos.map(x=>x.status).filter(Boolean))].sort()); fillSelect("filterLocal", [...new Set(state.equipamentos.map(x=>x.local).filter(Boolean))].sort()); }
function fillSelect(id, values){ const el=$(id), current=el.value, first=el.options[0].textContent; el.innerHTML = `<option value="">${first}</option>` + values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join(""); el.value = current; }

function fillSmartLists(){
  const defaults = {
    tipoOptions:["Tablet","Smartphone","Notebook","Computador","Monitor","Impressora","Outro"],
    statusOptions:["Ativo","Reserva","Em manutenção","Baixado","Emprestado"],
    categoriaOptions:["ADM","Educacional","A9+","T500"],
    modeloOptions:[],
    localOptions:[],
    responsavelOptions:[],
    origemOptions:[]
  };
  const map = {
    tipoOptions:"tipo", categoriaOptions:"categoria", modeloOptions:"modelo",
    localOptions:"local", responsavelOptions:"responsavel", statusOptions:"status", origemOptions:"origem"
  };
  Object.entries(map).forEach(([listId,key])=>{
    const values = new Set(defaults[listId] || []);
    state.equipamentos.forEach(e=>{ if(e[key]) values.add(String(e[key]).trim()); });
    const dl = $(listId);
    if(dl) dl.innerHTML = [...values].filter(Boolean).sort((a,b)=>a.localeCompare(b)).map(v=>`<option value="${esc(v)}"></option>`).join("");
  });
}

function svgPhoto(title, icon, bg="#eaf2ff", fg="#164a8b"){
  const safeTitle = String(title || "Equipamento").replace(/[<>&]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="620" viewBox="0 0 900 620">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>
    <rect width="900" height="620" rx="46" fill="url(#g)"/>
    <circle cx="450" cy="245" r="132" fill="#ffffff" opacity=".86"/>
    <text x="450" y="292" font-size="150" text-anchor="middle" dominant-baseline="middle">${icon}</text>
    <text x="450" y="460" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="800" text-anchor="middle" fill="${fg}">${safeTitle}</text>
    <text x="450" y="520" font-family="Arial, Helvetica, sans-serif" font-size="28" text-anchor="middle" fill="#64748b">Imagem automática por tipo de item</text>
  </svg>`;
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}
const AUTO_PHOTOS = {
  tablet: svgPhoto("Tablet", "▭"),
  smartphone: svgPhoto("Smartphone", "📱", "#eefdf5", "#166534"),
  notebook: svgPhoto("Notebook", "💻", "#f3f0ff", "#5b21b6"),
  computador: svgPhoto("Computador", "🖥️", "#eef6ff", "#075985"),
  monitor: svgPhoto("Monitor", "🖥️", "#fff7ed", "#9a3412"),
  impressora: svgPhoto("Impressora", "🖨️", "#f8fafc", "#334155"),
  outro: svgPhoto("Equipamento", "📦", "#f1f5f9", "#334155")
};
function defaultPhotoByType(tipo){
  const key = normalizeKey(tipo || "outro");
  if(key.includes("tablet")) return AUTO_PHOTOS.tablet;
  if(key.includes("smart") || key.includes("celular") || key.includes("telefone")) return AUTO_PHOTOS.smartphone;
  if(key.includes("note") || key.includes("laptop")) return AUTO_PHOTOS.notebook;
  if(key.includes("comput") || key.includes("desktop") || key.includes("pc")) return AUTO_PHOTOS.computador;
  if(key.includes("monitor")) return AUTO_PHOTOS.monitor;
  if(key.includes("impress")) return AUTO_PHOTOS.impressora;
  return AUTO_PHOTOS.outro;
}
function photoForEquipment(e={}){ return (e.fotoUrl && String(e.fotoUrl).trim()) || defaultPhotoByType(e.tipo); }
function refreshAutoPhoto(){ renderPhotoAndQr(getFormData()); }

function uniqueSorted(key){
  return [...new Set(state.equipamentos.map(e=>String(e[key]||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
}
function populateBulkStatusControls(){
  const localSelect = $("bulkLocalSelect");
  const statusSelect = $("bulkStatusSelect");
  if(!localSelect || !statusSelect) return;
  const currentLocal = localSelect.value;
  const currentStatus = statusSelect.value;
  const locais = uniqueSorted("local");
  const statuses = new Set(["Ativo","Reserva","Em manutenção","Baixado","Emprestado", ...uniqueSorted("status")]);
  localSelect.innerHTML = '<option value="">Selecione o local</option>' + locais.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");
  statusSelect.innerHTML = '<option value="">Selecione o status</option>' + [...statuses].filter(Boolean).sort((a,b)=>a.localeCompare(b)).map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");
  if(locais.includes(currentLocal)) localSelect.value = currentLocal;
  if([...statuses].includes(currentStatus)) statusSelect.value = currentStatus;
}
function getBulkStatusSelection(){
  const local = $("bulkLocalSelect")?.value || "";
  const status = $("bulkStatusSelect")?.value || "";
  const obs = $("bulkStatusObs")?.value?.trim() || "";
  const items = state.equipamentos.filter(e=>String(e.local||"").trim() === local);
  return { local, status, obs, items };
}
function renderBulkPreview(){
  const msg = $("bulkStatusMsg"), list = $("bulkPreviewList");
  if(!msg || !list) return;
  const {local, status, items} = getBulkStatusSelection();
  if(!local){ msg.textContent = "Selecione um local para conferir."; list.classList.add("hidden"); list.innerHTML = ""; return; }
  const willChange = status ? items.filter(e=>(e.status || "Ativo") !== status).length : items.length;
  msg.textContent = status ? `${items.length} equipamento(s) encontrados em ${local}. ${willChange} terão o status alterado para ${status}.` : `${items.length} equipamento(s) encontrados em ${local}. Selecione o novo status para aplicar.`;
  list.classList.toggle("hidden", !items.length);
  list.innerHTML = items.slice(0,60).map(e=>`<div><b>${esc(e.patrimonio || e.hostname || e.numeroSerie || e.imei || "Sem identificação")}</b><span>${esc(e.tipo || "")} · ${esc(e.modelo || e.categoria || "")} · Status atual: ${esc(e.status || "Ativo")}</span></div>`).join("") + (items.length>60 ? `<div><b>+ ${items.length-60} equipamento(s)</b><span>Lista resumida para manter a tela leve.</span></div>` : "");
}
async function applyBulkStatusByLocal(){
  if(!canAdmin()) return toast("Apenas administrador.");
  const msg = $("bulkStatusMsg");
  const {local, status, obs, items} = getBulkStatusSelection();
  if(!local || !status){ if(msg) msg.textContent = "Selecione o local e o novo status."; return; }
  const toUpdate = items.filter(e=>(e.status || "Ativo") !== status);
  if(!items.length){ if(msg) msg.textContent = "Nenhum equipamento encontrado nesse local."; return; }
  if(!toUpdate.length){ if(msg) msg.textContent = `Todos os equipamentos de ${local} já estão com status ${status}.`; return; }
  const resumo = `${toUpdate.length} de ${items.length} equipamento(s) do local ${local} terão o status alterado para ${status}.`;
  if(!confirm(resumo + "\n\nDeseja confirmar essa alteração?")) return;
  try{
    for(let i=0;i<toUpdate.length;i+=450){
      const batch = writeBatch(state.db);
      toUpdate.slice(i,i+450).forEach(item=>{
        batch.update(doc(state.db,"equipamentos",item.id), {
          status,
          atualizadoEm: serverTimestamp(),
          atualizadoPor: state.user?.email || ""
        });
      });
      await batch.commit();
    }
    await addDoc(collection(state.db,"movimentacoes"), {
      acao:"Alteração de status por local",
      alteracoes:[resumo, obs ? `Observação: ${obs}` : "Sem observação"],
      local,
      status,
      usuario:state.user?.email||"",
      data:serverTimestamp()
    });
    if(msg) msg.textContent = "Alteração concluída com sucesso.";
    toast("Status atualizado por local");
    await loadEquipamentos();
    await loadHistory();
    renderBulkPreview();
  }catch(e){
    if(msg) msg.textContent = "Erro ao alterar status: " + errorText(e);
    toast("Erro ao alterar status");
  }
}

function applyFilters(){ const term = $("searchInput")?.value?.toLowerCase() || ""; const tipo = $("filterTipo")?.value || "", status = $("filterStatus")?.value || "", local = $("filterLocal")?.value || ""; state.filtered = state.equipamentos.filter(e=>{ const blob = Object.values(e).join(" ").toLowerCase(); return (!term || blob.includes(term)) && (!tipo || e.tipo===tipo) && (!status || e.status===status) && (!local || e.local===local); }); state.page=1; renderTable(); }
function renderTable(){
  const total=state.filtered.length, pages=Math.max(1, Math.ceil(total/state.perPage)); state.page=Math.min(state.page,pages); const rows=state.filtered.slice((state.page-1)*state.perPage, state.page*state.perPage);
  $("equipTable").innerHTML = rows.map(e=>`<tr class="clickable-row" data-view-equip="${e.id}"><td>${esc(e.tipo)}</td><td>${esc(e.modelo||e.categoria)}</td><td>${esc(e.numeroSerie||e.imei)}</td><td>${esc(e.patrimonio)}</td><td>${esc(e.hostname)}</td><td>${esc(e.local)}</td><td>${esc(e.responsavel)}</td><td><span class="pill ${pillClass(e.status)}">${esc(e.status||"Ativo")}</span></td><td class="table-actions"><button class="btn small secondary" data-view-equip="${e.id}">Ver</button> ${canEdit()?`<button class="btn small secondary" data-edit="${e.id}">Editar</button>`:""} ${canAdmin()?`<button class="btn small danger" data-del="${e.id}">Excluir</button>`:""}</td></tr>`).join("");
  $("resultCount").textContent = `${total} itens`; $("pageInfo").textContent = `${state.page} / ${pages}`;
}
function renderDashboard(){ const count=(fn)=>state.equipamentos.filter(fn).length; $("kpiTotal").textContent=state.equipamentos.length; $("kpiTablets").textContent=count(e=>e.tipo==="Tablet"); $("kpiNotebooks").textContent=count(e=>e.tipo==="Notebook"); $("kpiComputadores").textContent=count(e=>e.tipo==="Computador"); $("kpiSmartphones").textContent=count(e=>e.tipo==="Smartphone"); $("kpiManutencao").textContent=count(e=>e.status==="Em manutenção"); $("kpiReserva").textContent=count(e=>e.status==="Reserva"); $("kpiBaixados").textContent=count(e=>e.status==="Baixado"); makeBars("tipoBars", groupBy(state.equipamentos,"tipo")); makeBars("localBars", Object.fromEntries(Object.entries(groupBy(state.equipamentos,"local")).sort((a,b)=>b[1]-a[1]).slice(0,8))); }
function groupBy(arr,key){ return arr.reduce((acc,e)=>{ const k=e[key]||"Não informado"; acc[k]=(acc[k]||0)+1; return acc; },{}); }
function makeBars(id,data){ const max=Math.max(1,...Object.values(data)); $(id).innerHTML=Object.entries(data).map(([k,v])=>`<div class="bar-row"><span>${esc(k)}</span><div class="bar-bg"><div class="bar-fill" style="width:${Math.round(v/max*100)}%"></div></div><b>${v}</b></div>`).join("") || "<p>Nenhum dado ainda.</p>";}
function getFormData(){ return ["tipo","categoria","modelo","numeroSerie","patrimonio","imei","hostname","local","etiqueta","responsavel","status","origem","fotoUrl","observacao"].reduce((o,id)=>{o[id]=$(id).value.trim(); return o;},{}); }
function setFormData(e={}){ ["tipo","categoria","modelo","numeroSerie","patrimonio","imei","hostname","local","etiqueta","responsavel","status","origem","fotoUrl","observacao"].forEach(id=>$(id).value=e[id]||""); $("tipo").value=e.tipo||"Tablet"; $("status").value=e.status||"Ativo"; $("editId").value=e.id||""; $("formTitle").textContent=e.id?"Editar equipamento":"Novo equipamento"; renderPhotoAndQr(e); document.querySelectorAll("#equipForm input,#equipForm select,#equipForm textarea,#equipForm button[type='submit']").forEach(el=>{ if(el.id!=="clearFormBtn") el.disabled=!canEdit(); }); }
function renderPhotoAndQr(e={}){ const img=$("photoPreview"), qr=$("qrBox"); const photo = photoForEquipment(e); if(photo){ img.src=photo; img.classList.remove("hidden"); img.title = e.fotoUrl ? "Foto manual do equipamento" : "Imagem automática pelo tipo do item"; } else { img.removeAttribute("src"); img.classList.add("hidden"); } const code=e.id || e.patrimonio || e.numeroSerie || e.imei || e.hostname; if(code){ const qrData = e.id ? `${location.origin}${location.pathname}?equip=${encodeURIComponent(e.id)}` : code; const text=encodeURIComponent(qrData); qr.innerHTML=`<img alt="QR Code" src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${text}"><small>QR Code do equipamento</small><small class="muted">${e.id ? "Abre este equipamento no sistema" : "Salve o cadastro para gerar o link direto"}</small>`; qr.classList.remove("hidden"); } else qr.classList.add("hidden"); }
async function saveEquip(e){
  e.preventDefault(); if(!canEdit()){ toast("Seu usuário é somente consulta."); return; }
  const data=getFormData(); const id=$("editId").value;
  try{ if(id){ const old=state.equipamentos.find(x=>x.id===id)||{}; await updateDoc(doc(state.db,"equipamentos",id), {...data, atualizadoEm:serverTimestamp(), atualizadoPor:state.user?.email||""}); await logMov(id, data, old, "Atualização"); toast("Equipamento atualizado"); } else { const ref=await addDoc(collection(state.db,"equipamentos"), {...data, criadoEm:serverTimestamp(), atualizadoEm:serverTimestamp(), criadoPor:state.user?.email||"", atualizadoPor:state.user?.email||""}); await addDoc(collection(state.db,"movimentacoes"), {equipamentoId:ref.id, patrimonio:data.patrimonio||"", serie:data.numeroSerie||data.imei||"", acao:"Cadastro", alteracoes:["Equipamento cadastrado"], usuario:state.user?.email||"", data:serverTimestamp()}); toast("Equipamento cadastrado"); } setFormData(); await loadEquipamentos(); await loadHistory(); showView("equipamentos"); } catch(err){ toast("Erro ao salvar: "+errorText(err)); }
}
async function logMov(id, data, old, acao){ const changes=[]; ["local","responsavel","status","patrimonio","hostname","modelo","numeroSerie","imei","fotoUrl"].forEach(k=>{ if((old[k]||"") !== (data[k]||"")) changes.push(`${k}: "${old[k]||""}" → "${data[k]||""}"`); }); if(changes.length) await addDoc(collection(state.db,"movimentacoes"), {equipamentoId:id, patrimonio:data.patrimonio||"", serie:data.numeroSerie||data.imei||"", acao, alteracoes:changes, usuario:state.user?.email||"", data:serverTimestamp()}); }
async function loadHistory(){ try{ const q=query(collection(state.db,"movimentacoes"), orderBy("data","desc"), limit(60)); const snap=await getDocs(q); $("historyList").innerHTML = snap.docs.map(d=>{ const h=d.data(); const dt=h.data?.toDate ? h.data.toDate().toLocaleString("pt-BR") : ""; return `<div class="history-item"><strong>${esc(h.acao||"Alteração")} · ${esc(h.patrimonio||h.serie||"Equipamento")}</strong><br><small>${esc(dt)} · ${esc(h.usuario||"")}</small><br>${(h.alteracoes||[]).map(esc).join("<br>")}</div>`; }).join("") || "<p>Nenhuma movimentação registrada ainda.</p>"; } catch(e){ $("historyList").innerHTML="<p>Histórico indisponível. Confira as regras do Firestore.</p>"; } }
async function seedInitial(){ if(!canAdmin()) return toast("Apenas administrador."); if(!confirm("Enviar os dados iniciais das planilhas para o Firebase? Use apenas uma vez.")) return; try{ const existing=state.equipamentos.length; if(existing && !confirm(`Já existem ${existing} equipamentos. Deseja continuar mesmo assim?`)) return; const dados=window.DADOS_INICIAIS||[]; for(let i=0;i<dados.length;i+=450){ const batch=writeBatch(state.db); dados.slice(i,i+450).forEach(item=>{ const ref=doc(collection(state.db,"equipamentos")); const {id,...data}=item; batch.set(ref,{...data, criadoEm:serverTimestamp(), atualizadoEm:serverTimestamp(), criadoPor:state.user?.email||""}); }); await batch.commit(); } await addDoc(collection(state.db,"movimentacoes"), {acao:"Importação", alteracoes:[`Importados ${dados.length} equipamentos iniciais`], usuario:state.user?.email||"", data:serverTimestamp()}); toast("Dados iniciais enviados"); await loadEquipamentos(); await loadHistory(); }catch(e){ toast("Erro ao enviar dados: "+errorText(e)); } }

function normalizeKey(s){
  return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
}
function getVal(row, aliases){
  const entries = Object.entries(row);
  for(const alias of aliases){
    const na = normalizeKey(alias);
    const found = entries.find(([k])=>normalizeKey(k)===na || normalizeKey(k).includes(na));
    if(found && found[1] !== undefined && found[1] !== null) return String(found[1]).trim();
  }
  return "";
}
function mapExcelRow(row, origemArquivo){
  return {
    tipo: getVal(row,["tipo","equipamento","tipo equipamento"]) || "Outro",
    categoria: getVal(row,["categoria","setor categoria","grupo"]),
    modelo: getVal(row,["modelo","descricao","descrição","produto"]),
    numeroSerie: getVal(row,["numero serie","n serie","serie","serial","nº de série","n° de série"]),
    patrimonio: getVal(row,["patrimonio","patrimônio","n patrimonio","nº patrimonio","tombo"]),
    imei: getVal(row,["imei"]),
    hostname: getVal(row,["hostname","nome computador","nome do computador","computador"]),
    local: getVal(row,["local","sala","setor","ambiente"]),
    etiqueta: getVal(row,["etiqueta","identificacao","identificação"]),
    responsavel: getVal(row,["responsavel","responsável","usuario","usuário"]),
    status: getVal(row,["status","situacao","situação"]) || "Ativo",
    origem: getVal(row,["origem"]) || origemArquivo || "Importação Excel",
    fotoUrl: getVal(row,["foto","fotoUrl","url foto"]),
    observacao: getVal(row,["observacao","observação","obs"])
  };
}
function isEmptyEquip(e){
  return ![e.patrimonio,e.numeroSerie,e.imei,e.hostname,e.modelo,e.local].some(Boolean);
}
async function importExcel(file){
  if(!canAdmin()) return toast("Apenas administrador.");
  if(!window.XLSX) return toast("Biblioteca de Excel não carregou. Verifique a internet e atualize a página.");
  $("excelImportMsg").textContent = "Lendo planilha...";
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {type:"array"});
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, {defval:""});
  const equipamentos = rows.map(r=>mapExcelRow(r, file.name)).filter(e=>!isEmptyEquip(e));
  if(!equipamentos.length){ $("excelImportMsg").textContent = "Nenhum equipamento reconhecido na planilha."; return; }
  if(!confirm(`Importar ${equipamentos.length} equipamentos para o Firebase?`)) { $("excelImportMsg").textContent = "Importação cancelada."; return; }
  for(let i=0;i<equipamentos.length;i+=450){
    const batch=writeBatch(state.db);
    equipamentos.slice(i,i+450).forEach(item=>{
      const ref=doc(collection(state.db,"equipamentos"));
      batch.set(ref,{...item, criadoEm:serverTimestamp(), atualizadoEm:serverTimestamp(), criadoPor:state.user?.email||"", atualizadoPor:state.user?.email||""});
    });
    await batch.commit();
  }
  await addDoc(collection(state.db,"movimentacoes"), {acao:"Importação Excel", alteracoes:[`Importados ${equipamentos.length} equipamentos do arquivo ${file.name}`], usuario:state.user?.email||"", data:serverTimestamp()});
  $("excelImportMsg").textContent = `Importação concluída: ${equipamentos.length} equipamentos enviados.`;
  toast("Excel importado com sucesso");
  await loadEquipamentos(); await loadHistory();
}
function downloadExcelModel(){
  const headers=["tipo","categoria","modelo","numeroSerie","patrimonio","imei","hostname","local","etiqueta","responsavel","status","origem","observacao"];
  const sample=["Notebook","ADM","Dell Latitude","","12345","","NB-ADM-01","TI","","Alan","Ativo","Modelo manual",""];
  download("modelo_importacao_inventario.csv", "\ufeff"+headers.join(";")+"\n"+sample.map(v=>`\"${String(v).replaceAll('"','""')}\"`).join(";"), "text/csv;charset=utf-8");
}
async function openEquipmentById(id, source="") {
  let item = state.equipamentos.find(x=>x.id===id);
  if(!item && state.db){
    try{
      const snap = await getDoc(doc(state.db,"equipamentos",id));
      if(snap.exists()){
        item = {id:snap.id, ...snap.data()};
        if(!state.equipamentos.some(x=>x.id===item.id)) state.equipamentos.push(item);
      }
    }catch(_){}
  }
  if(!item) return false;
  renderEquipmentDetail(item);
  showView("detalhe");
  if(source) toast(source);
  return true;
}
function fieldBlock(label, value){ return `<div class="detail-field"><span>${esc(label)}</span><b>${esc(value || "Não informado")}</b></div>`; }
function renderEquipmentDetail(e={}){
  state.currentDetailId = e.id || null;
  const title = e.patrimonio || e.hostname || e.numeroSerie || e.imei || e.modelo || "Equipamento";
  $("detailTitle").textContent = title;
  $("detailSubtitle").textContent = `${e.tipo || "Tipo não informado"}${e.local ? " · " + e.local : ""}`;
  const qrData = e.id ? `${location.origin}${location.pathname}?equip=${encodeURIComponent(e.id)}` : (e.patrimonio || e.numeroSerie || e.imei || e.hostname || "");
  const qrHtml = qrData ? `<div class="detail-qr"><img alt="QR Code" src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrData)}"><small>QR Code deste equipamento</small></div>` : "";
  const photo = photoForEquipment(e);
  const fotoHtml = photo ? `<img class="detail-photo" src="${esc(photo)}" alt="Foto do equipamento">` : `<div class="detail-photo empty">Sem foto</div>`;
  $("detailContent").innerHTML = `
    <div class="detail-top">
      ${fotoHtml}
      ${qrHtml}
    </div>
    <div class="detail-grid">
      ${fieldBlock("Tipo", e.tipo)}
      ${fieldBlock("Categoria", e.categoria)}
      ${fieldBlock("Modelo", e.modelo)}
      ${fieldBlock("Nº de série", e.numeroSerie)}
      ${fieldBlock("Patrimônio", e.patrimonio)}
      ${fieldBlock("IMEI", e.imei)}
      ${fieldBlock("Hostname", e.hostname)}
      ${fieldBlock("Local", e.local)}
      ${fieldBlock("Etiqueta", e.etiqueta)}
      ${fieldBlock("Responsável", e.responsavel)}
      ${fieldBlock("Status", e.status || "Ativo")}
      ${fieldBlock("Origem", e.origem)}
    </div>
    <div class="detail-observation"><span>Observação</span><p>${esc(e.observacao || "Nenhuma observação cadastrada.")}</p></div>
  `;
  const editBtn = $("editDetailBtn");
  if(editBtn) editBtn.classList.toggle("hidden", !canEdit());
}

function extractEquipIdFromCode(code){
  const clean=String(code||"").trim();
  if(!clean) return "";
  try{
    const url = new URL(clean);
    return url.searchParams.get("equip") || url.searchParams.get("id") || "";
  }catch(_){ return ""; }
}
function findEquipmentByCode(code){
  const clean=String(code||"").trim();
  if(!clean) return null;
  const equipId = extractEquipIdFromCode(clean);
  if(equipId) return state.equipamentos.find(x=>x.id===equipId) || { id:equipId, __needsFetch:true };
  return state.equipamentos.find(e=>[e.id,e.patrimonio,e.numeroSerie,e.imei,e.hostname].some(v=>String(v||"").trim()===clean)) || null;
}
function openEquipmentFromUrlIfNeeded(){
  const id = new URLSearchParams(location.search).get("equip");
  if(id && state.equipamentos.length && !state.pendingEquipId){
    state.pendingEquipId = id;
    setTimeout(()=>openEquipmentById(id, "Equipamento aberto pelo QR Code"), 300);
  }
}
async function startQrScanner(){
  const msg=$("qrScanMsg");
  if(!window.Html5Qrcode){ msg.textContent="Leitor de QR Code não carregou. Verifique a internet e atualize a página."; return; }
  if(state.qrScanner){ msg.textContent="Câmera já iniciada."; return; }
  try{
    state.qrScanner = new Html5Qrcode("qrReader");
    msg.textContent="Abrindo câmera...";
    await state.qrScanner.start({facingMode:"environment"}, {fps:10, qrbox:{width:250,height:250}}, async (decodedText)=>{
      msg.textContent="QR Code lido. Localizando equipamento...";
      const item = findEquipmentByCode(decodedText);
      if(item){
        await stopQrScanner();
        const opened = await openEquipmentById(item.id, "Equipamento localizado pelo QR Code");
        if(!opened) msg.textContent="QR Code lido, mas equipamento não encontrado no Firebase: " + decodedText;
      } else {
        msg.textContent="QR Code lido, mas equipamento não encontrado: " + decodedText;
      }
    });
    msg.textContent="Aponte a câmera para o QR Code do equipamento.";
  }catch(e){ msg.textContent="Erro ao iniciar câmera: "+errorText(e); state.qrScanner=null; }
}
async function stopQrScanner(){
  const msg=$("qrScanMsg");
  if(state.qrScanner){
    try{ await state.qrScanner.stop(); await state.qrScanner.clear(); }catch(_){}
    state.qrScanner=null;
    if(msg) msg.textContent="Câmera parada.";
  }
}

function populateQrPdfControls(){
  const select = $("qrPdfTipoSelect");
  if(!select) return;
  const current = select.value;
  const tipos = uniqueSorted("tipo");
  select.innerHTML = '<option value="">Selecione o tipo</option>' + tipos.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");
  if(tipos.includes(current)) select.value = current;
}
function getQrPdfItems(){
  const tipo = $("qrPdfTipoSelect")?.value || "";
  const order = $("qrPdfOrderSelect")?.value || "patrimonio";
  const items = state.equipamentos
    .filter(e=>String(e.tipo||"").trim() === tipo)
    .slice()
    .sort((a,b)=>String(a[order]||"").localeCompare(String(b[order]||""), "pt-BR", {numeric:true}) || String(a.patrimonio||"").localeCompare(String(b.patrimonio||""), "pt-BR", {numeric:true}));
  return {tipo, order, items};
}
function renderQrPdfPreview(){
  const msg = $("qrPdfMsg"), list = $("qrPdfPreviewList");
  if(!msg || !list) return;
  const {tipo, items} = getQrPdfItems();
  if(!tipo){ msg.textContent = "Selecione um tipo de equipamento."; list.classList.add("hidden"); list.innerHTML = ""; return; }
  msg.textContent = `${items.length} equipamento(s) do tipo ${tipo} serão incluídos no PDF.`;
  list.classList.toggle("hidden", !items.length);
  list.innerHTML = items.slice(0,80).map(e=>`<div><b>${esc(e.patrimonio || e.hostname || e.numeroSerie || e.imei || "Sem identificação")}</b><span>${esc(e.hostname || "Sem hostname")} · Série: ${esc(e.numeroSerie || e.imei || "Não informado")} · Local: ${esc(e.local || "")}</span></div>`).join("") + (items.length>80 ? `<div><b>+ ${items.length-80} equipamento(s)</b><span>Lista resumida para manter a tela leve.</span></div>` : "");
}
function sanitizeFileName(s){
  return String(s||"equipamentos").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"_").replace(/^_+|_+$/g,"").toLowerCase() || "equipamentos";
}
function getQrPayload(e){
  return e.id ? `${location.origin}${location.pathname}?equip=${encodeURIComponent(e.id)}` : (e.patrimonio || e.numeroSerie || e.imei || e.hostname || "");
}
async function makeQrDataUrl(text){
  if(window.QRCode?.toDataURL){
    return await window.QRCode.toDataURL(text, {errorCorrectionLevel:"M", margin:1, width:220});
  }
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(text)}`;
}
async function generateQrPdf(){
  if(!canAdmin()) return toast("Apenas administrador.");
  const msg = $("qrPdfMsg");
  const {tipo, items} = getQrPdfItems();
  const size = $("qrPdfSizeSelect")?.value || "medium";
  if(!tipo){ if(msg) msg.textContent = "Selecione o tipo de equipamento."; return; }
  if(!items.length){ if(msg) msg.textContent = "Nenhum equipamento encontrado para esse tipo."; return; }
  if(!window.jspdf?.jsPDF){ if(msg) msg.textContent = "Biblioteca de PDF não carregou. Verifique a internet e atualize a página."; return; }
  if(msg) msg.textContent = `Gerando PDF com ${items.length} etiqueta(s)...`;
  const { jsPDF } = window.jspdf;
  const docPdf = new jsPDF({orientation:"portrait", unit:"mm", format:"a4"});
  const pageW = docPdf.internal.pageSize.getWidth();
  const pageH = docPdf.internal.pageSize.getHeight();
  const margin = 8;
  const gap = 4;
  const layouts = {
    small:{cols:3, rows:8, qr:20, fontTitle:8, fontText:6.5},
    medium:{cols:2, rows:6, qr:26, fontTitle:9, fontText:7.5},
    large:{cols:1, rows:5, qr:30, fontTitle:11, fontText:9}
  };
  const layout = layouts[size] || layouts.medium;
  const labelW = (pageW - margin*2 - gap*(layout.cols-1)) / layout.cols;
  const labelH = (pageH - margin*2 - gap*(layout.rows-1)) / layout.rows;
  let index = 0;
  docPdf.setProperties({title:`QR Codes - ${tipo}`, subject:"Etiquetas de inventário SESI"});
  for(const e of items){
    if(index > 0 && index % (layout.cols*layout.rows) === 0) docPdf.addPage();
    const pos = index % (layout.cols*layout.rows);
    const col = pos % layout.cols;
    const row = Math.floor(pos / layout.cols);
    const x = margin + col*(labelW + gap);
    const y = margin + row*(labelH + gap);
    const payload = getQrPayload(e);
    const qrUrl = await makeQrDataUrl(payload || `${e.patrimonio || e.hostname || e.numeroSerie || "equipamento"}`);
    docPdf.setDrawColor(210, 220, 235);
    docPdf.roundedRect(x, y, labelW, labelH, 2, 2);
    const qrX = x + 3;
    const qrY = y + (labelH - layout.qr) / 2;
    docPdf.addImage(qrUrl, "PNG", qrX, qrY, layout.qr, layout.qr);
    const tx = qrX + layout.qr + 3;
    const maxTextW = labelW - layout.qr - 9;
    docPdf.setTextColor(15, 42, 82);
    docPdf.setFont("helvetica", "bold");
    docPdf.setFontSize(layout.fontTitle);
    docPdf.text(docPdf.splitTextToSize(e.patrimonio ? `Patrimônio: ${e.patrimonio}` : "Patrimônio: não informado", maxTextW), tx, y + 8);
    docPdf.setFont("helvetica", "normal");
    docPdf.setTextColor(30, 45, 65);
    docPdf.setFontSize(layout.fontText);
    const lines = [
      `Hostname: ${e.hostname || "não informado"}`,
      `Nº série: ${e.numeroSerie || e.imei || "não informado"}`,
      `Tipo: ${e.tipo || ""}`,
      `Local: ${e.local || ""}`
    ];
    let ty = y + (size === "large" ? 17 : 16);
    for(const line of lines){
      const split = docPdf.splitTextToSize(line, maxTextW);
      docPdf.text(split.slice(0,2), tx, ty);
      ty += split.length > 1 ? layout.fontText*0.9 : layout.fontText*0.55;
      if(ty > y + labelH - 3) break;
    }
    index++;
  }
  docPdf.save(`qr_codes_${sanitizeFileName(tipo)}.pdf`);
  if(msg) msg.textContent = `PDF gerado com ${items.length} etiqueta(s) do tipo ${tipo}.`;
  toast("PDF de QR Codes gerado");
}

function exportCSV(){ const headers=["tipo","categoria","modelo","numeroSerie","patrimonio","imei","hostname","local","etiqueta","responsavel","status","origem","fotoUrl","observacao"]; const lines=[headers.join(";")].concat(state.filtered.map(e=>headers.map(h=>`"${String(e[h]||"").replaceAll('"','""')}"`).join(";"))); download("inventario_sesi.csv", "\ufeff"+lines.join("\n"), "text/csv;charset=utf-8"); }
function backupJSON(){ download("backup_inventario_sesi.json", JSON.stringify(state.equipamentos,null,2), "application/json"); }
async function importJSON(file){ if(!canAdmin()) return toast("Apenas administrador."); const text=await file.text(); const arr=JSON.parse(text); if(!Array.isArray(arr)) throw new Error("Arquivo inválido"); if(!confirm(`Importar ${arr.length} equipamentos para o Firebase?`)) return; for(let i=0;i<arr.length;i+=450){ const batch=writeBatch(state.db); arr.slice(i,i+450).forEach(item=>{ const ref=doc(collection(state.db,"equipamentos")); const {id,...data}=item; batch.set(ref,{...data, atualizadoEm:serverTimestamp(), atualizadoPor:state.user?.email||""}); }); await batch.commit(); } await loadEquipamentos(); toast("Backup importado"); }
async function deleteAll(){ if(!canAdmin()) return toast("Apenas administrador."); if(!confirm("Apagar TODOS os equipamentos do Firebase?")) return; if(!confirm("Confirma novamente? Essa ação não tem volta.")) return; const snap=await getDocs(collection(state.db,"equipamentos")); for(let i=0;i<snap.docs.length;i+=450){ const batch=writeBatch(state.db); snap.docs.slice(i,i+450).forEach(d=>batch.delete(d.ref)); await batch.commit(); } await addDoc(collection(state.db,"movimentacoes"), {acao:"Exclusão geral", alteracoes:["Todos os equipamentos foram apagados"], usuario:state.user?.email||"", data:serverTimestamp()}); await loadEquipamentos(); toast("Todos os equipamentos foram apagados"); }
async function loadUsers(){ const snap=await getDocs(collection(state.db,"usuarios")); state.usuarios=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.email||"").localeCompare(b.email||"")); renderUsers(); }
function renderUsers(){ $("usersList").innerHTML = state.usuarios.map(u=>`<div class="user-row"><div><b>${esc(u.nome||u.email)}</b><small>${esc(u.email||"")}</small></div><select data-role-user="${u.id}"><option value="admin" ${u.nivel==="admin"?"selected":""}>Administrador</option><option value="tecnico" ${u.nivel==="tecnico"?"selected":""}>Técnico TI</option><option value="consulta" ${!u.nivel||u.nivel==="consulta"?"selected":""}>Consulta</option></select><button class="btn secondary small" data-save-role="${u.id}">Salvar</button></div>`).join("") || "<p>Nenhum usuário encontrado.</p>"; }
async function saveRole(uid){ if(!canAdmin()) return; const sel=document.querySelector(`[data-role-user="${uid}"]`); await updateDoc(doc(state.db,"usuarios",uid), {nivel:sel.value, atualizadoEm:serverTimestamp(), atualizadoPor:state.user?.email||""}); toast("Permissão atualizada"); await loadUsers(); }
function download(name, content, type){ const blob=new Blob([content],{type}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function showView(view){ if((view==="usuarios"||view==="config")&&!canAdmin()) return toast("Apenas administrador."); document.body.classList.remove("menu-open"); document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden")); $(`view-${view}`).classList.remove("hidden"); document.querySelectorAll(".sidebar nav a").forEach(a=>a.classList.toggle("active", a.dataset.view===view)); $("pageTitle").textContent = {dashboard:"Dashboard", equipamentos:"Equipamentos", detalhe:"Detalhes do equipamento", cadastro:"Cadastro", qrscanner:"Escanear QR Code", movimentacoes:"Histórico", usuarios:"Usuários", config:"Configurações"}[view]; if(view==="usuarios") loadUsers(); }
function esc(s){ return String(s??"").replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])); }
function pillClass(s){ return String(s||"Ativo").split(" ")[0]; }
async function compressImage(file){ return new Promise((resolve,reject)=>{ const reader=new FileReader(); reader.onload=()=>{ const img=new Image(); img.onload=()=>{ const canvas=document.createElement("canvas"); const max=900; let w=img.width,h=img.height; if(w>h && w>max){h=Math.round(h*max/w); w=max;} else if(h>max){w=Math.round(w*max/h); h=max;} canvas.width=w; canvas.height=h; canvas.getContext("2d").drawImage(img,0,0,w,h); resolve(canvas.toDataURL("image/jpeg",.78)); }; img.onerror=reject; img.src=reader.result; }; reader.onerror=reject; reader.readAsDataURL(file); }); }

document.addEventListener("click", async (e)=>{
  const viewEquip=e.target.closest("[data-view-equip]")?.dataset?.viewEquip;
  const edit=e.target.closest("[data-edit]")?.dataset?.edit;
  const del=e.target.closest("[data-del]")?.dataset?.del;
  const saveRoleId=e.target.dataset?.saveRole;
  if(viewEquip && !edit && !del){ await openEquipmentById(viewEquip); return; }
  if(edit){ const item=state.equipamentos.find(x=>x.id===edit); setFormData(item); showView("cadastro"); return; }
  if(del && canAdmin() && confirm("Excluir este equipamento?")){ const item=state.equipamentos.find(x=>x.id===del)||{}; await deleteDoc(doc(state.db,"equipamentos",del)); await addDoc(collection(state.db,"movimentacoes"), {equipamentoId:del, patrimonio:item.patrimonio||"", serie:item.numeroSerie||item.imei||"", acao:"Exclusão", alteracoes:["Equipamento excluído"], usuario:state.user?.email||"", data:serverTimestamp()}); await loadEquipamentos(); await loadHistory(); toast("Equipamento excluído"); return; }
  if(saveRoleId) await saveRole(saveRoleId);
});
document.querySelectorAll(".sidebar nav a").forEach(a=>a.addEventListener("click",ev=>{ev.preventDefault(); showView(a.dataset.view);}));
$("loginBtn").onclick=login; $("createUserBtn").onclick=createUser; $("logoutBtn").onclick=()=>signOut(state.auth);
$("backToListBtn").onclick=()=>showView("equipamentos");
$("editDetailBtn").onclick=()=>{ const item=state.equipamentos.find(x=>x.id===state.currentDetailId); if(item){ setFormData(item); showView("cadastro"); } };
$("equipForm").onsubmit=saveEquip; $("clearFormBtn").onclick=()=>setFormData(); $("openNewBtn").onclick=()=>{setFormData(); showView("cadastro");};
$("seedBtn").onclick=seedInitial; $("qrPdfPreviewBtn").onclick=renderQrPdfPreview; $("generateQrPdfBtn").onclick=generateQrPdf; $("qrPdfTipoSelect").onchange=renderQrPdfPreview; $("qrPdfOrderSelect").onchange=renderQrPdfPreview; $("qrPdfSizeSelect").onchange=renderQrPdfPreview; $("bulkPreviewBtn").onclick=renderBulkPreview; $("bulkApplyStatusBtn").onclick=applyBulkStatusByLocal; $("bulkLocalSelect").onchange=renderBulkPreview; $("bulkStatusSelect").onchange=renderBulkPreview; $("exportBtn").onclick=exportCSV; $("backupJsonBtn").onclick=backupJSON; $("deleteAllBtn").onclick=deleteAll; $("downloadModelBtn").onclick=downloadExcelModel; $("startQrBtn").onclick=startQrScanner; $("stopQrBtn").onclick=stopQrScanner;
$("importJsonInput").onchange=(e)=>e.target.files[0]&&importJSON(e.target.files[0]).catch(err=>toast("Erro ao importar: "+errorText(err)));
$("importExcelInput").onchange=(e)=>e.target.files[0]&&importExcel(e.target.files[0]).catch(err=>{ $("excelImportMsg").textContent="Erro ao importar Excel: "+errorText(err); toast("Erro ao importar Excel"); });
$("fotoInput").onchange=async(e)=>{ const file=e.target.files?.[0]; if(!file) return; try{ $("fotoUrl").value=await compressImage(file); renderPhotoAndQr(getFormData()); toast("Foto manual carregada no cadastro"); }catch(err){ toast("Erro ao carregar foto: "+errorText(err)); } };
$("fotoUrl").addEventListener("input",()=>renderPhotoAndQr(getFormData()));
$("tipo").addEventListener("input", refreshAutoPhoto);
$("categoria").addEventListener("input", refreshAutoPhoto);
["searchInput","filterTipo","filterStatus","filterLocal"].forEach(id=>$(id)?.addEventListener("input",applyFilters));
$("prevPage").onclick=()=>{state.page=Math.max(1,state.page-1);renderTable();}; $("nextPage").onclick=()=>{state.page+=1;renderTable();};

const mobileMenuBtn = $("mobileMenuBtn");
const mobileMenuBackdrop = $("mobileMenuBackdrop");
if(mobileMenuBtn) mobileMenuBtn.onclick = () => document.body.classList.toggle("menu-open");
if(mobileMenuBackdrop) mobileMenuBackdrop.onclick = () => document.body.classList.remove("menu-open");
initFirebase();
