const $=id=>document.getElementById(id);
const SERVER_KEY='justeau_v7_server';
let sb=null,currentUser=null,currentProfile=null,profiles=[],repairs=[],parts=[],currentRepair=null,currentPartRepair=null,realtimeChannels=[];
const ACCOUNTING_COMPANIES=['Justeau Frères','SECA','SAS Havard'];

function toast(msg){const t=$('toast');t.textContent=msg;t.hidden=false;setTimeout(()=>t.hidden=true,2600)}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function slug(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}
function frDate(v){if(!v)return'';const d=new Date(v+'T12:00:00');return d.toLocaleDateString('fr-FR')}
function money(v){return (Number(v)||0).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})+' €'}
function hoursLabel(v){const n=Number(v)||0,h=Math.floor(n),m=Math.round((n-h)*60);return `${h} h${m?` ${String(m).padStart(2,'0')}`:''}`}
function isManager(){return currentProfile?.role==='manager'}
function profileName(id){return profiles.find(p=>p.id===id)?.full_name||'Non attribué'}
function repairNo(r){return r.repair_no?`R-${String(r.repair_no).padStart(6,'0')}`:'R-…'}

function getServer(){try{return JSON.parse(localStorage.getItem(SERVER_KEY)||'null')}catch{return null}}
function saveServer(){const url=$('supabaseUrl').value.trim(),key=$('supabaseKey').value.trim();if(!url||!key)return alert('Renseignez l’URL et la clé publique Supabase.');localStorage.setItem(SERVER_KEY,JSON.stringify({url,key}));location.reload()}
function clearServer(){if(confirm('Changer la configuration du serveur sur cet appareil ?')){localStorage.removeItem(SERVER_KEY);location.reload()}}
function initSupabase(){
  const s=getServer(); if(!s){$('setupPanel').hidden=false;return false}
  $('setupPanel').hidden=true; $('authPanel').hidden=false;
  sb=supabase.createClient(s.url,s.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  return true
}
async function boot(){
  if(!initSupabase())return;
  const {data:{session}}=await sb.auth.getSession();
  if(session)await enterApp(session.user);
  sb.auth.onAuthStateChange(async(_event,session)=>{if(session?.user&&!currentUser)await enterApp(session.user);if(!session){showAuth()}})
}
function showAuth(){$('appPanel').hidden=true;$('authPanel').hidden=false;$('logoutBtn').hidden=true;$('shareBtn').hidden=true;$('roleBadge').hidden=true;currentUser=currentProfile=null}
async function login(){
  const email=$('email').value.trim(),password=$('password').value;
  const {error}=await sb.auth.signInWithPassword({email,password});
  if(error)alert('Connexion impossible : '+error.message);
}
async function logout(){await sb.auth.signOut()}
async function enterApp(user){
  currentUser=user;
  const {data:p,error}=await sb.from('profiles').select('*').eq('id',user.id).single();
  if(error||!p){alert('Votre compte existe mais aucun profil Justeau SAV n’est configuré. Demandez au gestionnaire de vous créer dans la table profiles.');await sb.auth.signOut();return}
  currentProfile=p;
  $('authPanel').hidden=true;$('appPanel').hidden=false;$('logoutBtn').hidden=false;$('shareBtn').hidden=false;$('roleBadge').hidden=false;
  $('roleBadge').textContent=isManager()?'GESTIONNAIRE':'MÉCANICIEN';
  document.querySelectorAll('.manager-only').forEach(el=>el.hidden=!isManager());
  $('repairHeading').textContent=isManager()?'Réparations atelier':'Mes réparations';
  $('repairSubheading').textContent=isManager()?'Toutes les fiches de l’atelier':'Fiches qui vous sont attribuées';
  $('partsHeading').textContent=isManager()?'Commandes à faire':'Mes demandes de pièces';
  await reloadAll(); subscribeRealtime();
}
async function reloadAll(){
  await Promise.all([loadProfiles(),loadRepairs(),loadParts()]);
  renderAll();
}
async function loadProfiles(){
  const {data,error}=await sb.from('profiles').select('*').order('full_name');
  if(error)throw error;profiles=data||[];
}
async function loadRepairs(){
  let q=sb.from('repairs').select('*').order('created_at',{ascending:false});
  if(!isManager())q=q.eq('assigned_to',currentUser.id);
  const {data,error}=await q;if(error)throw error;repairs=data||[];
}
async function loadParts(){
  let q=sb.from('part_requests').select('*').order('created_at',{ascending:false});
  if(!isManager())q=q.eq('requested_by',currentUser.id);
  const {data,error}=await q;if(error)throw error;parts=data||[];
}
function subscribeRealtime(){
  realtimeChannels.forEach(c=>sb.removeChannel(c));realtimeChannels=[];
  ['repairs','part_requests','profiles'].forEach(table=>{
    const c=sb.channel('v7-'+table).on('postgres_changes',{event:'*',schema:'public',table},async()=>{await reloadAll()}).subscribe();
    realtimeChannels.push(c);
  });
}
function renderAll(){renderRepairs();renderParts();renderWorkshop();renderTeam();refreshReport();fillMechanics()}
function renderRepairs(){
  const q=$('repairSearch').value.trim().toLowerCase(),st=$('repairStatusFilter').value,pr=$('repairPriorityFilter').value;
  let rows=repairs.filter(r=>!st||r.status===st).filter(r=>!pr||r.priority===pr).filter(r=>JSON.stringify(r).toLowerCase().includes(q));
  $('repairCount').textContent=rows.length;$('urgentCount').textContent=rows.filter(r=>r.priority==='Urgent'&&r.status!=='Réparé').length;$('doneCount').textContent=rows.filter(r=>r.status==='Réparé').length;
  const visibleRepairIds=new Set(rows.map(r=>r.id));$('openPartsCount').textContent=parts.filter(p=>visibleRepairIds.has(p.repair_id)&&!['Reçue','Annulée'].includes(p.status)).length;
  $('repairList').innerHTML=rows.length?rows.map(r=>`<article class="card priority-${slug(r.priority)}">
    <div class="card-head"><div><div class="number">${repairNo(r)}</div><h3>${esc(r.equipment)}</h3><div class="meta">${esc(r.company)} · ${esc([r.brand,r.model].filter(Boolean).join(' '))}${r.serial?' · '+esc(r.serial):''}${r.machine_hours!=null?' · Compteur '+esc(r.machine_hours)+' h':''}</div></div><div><span class="badge ${r.priority==='Urgent'?'urgent':''}">${esc(r.priority)}</span></div></div>
    <p><strong>Panne :</strong> ${esc(r.fault)}</p>
    <div class="meta">Mécanicien : <strong>${esc(profileName(r.assigned_to))}</strong> · Statut : ${esc(r.status)} · Arrivée : ${frDate(r.arrival_date)}</div>
    <div class="actions"><button class="secondary" onclick="openRepair('${r.id}')">Ouvrir</button></div>
  </article>`).join(''):'<div class="panel">Aucune réparation trouvée.</div>';
}
function fillMechanics(){
  const sel=$('assignedTo'),current=sel.value;
  const mechanics=profiles.filter(p=>p.active&&(p.role==='mechanic'||p.role==='manager'));
  sel.innerHTML='<option value="">Non attribué</option>'+mechanics.map(p=>`<option value="${p.id}">${esc(p.full_name)}</option>`).join('');
  if(current)sel.value=current;
}
function newRepair(){
  currentRepair=null;
  $('repairForm').reset();
  $('repairId').value='';
  $('repairNoLabel').textContent='Nouvelle intervention';
  $('arrivalDate').value=new Date().toISOString().slice(0,10);
  $('priority').value='Normale';
  $('repairStatus').value='En attente';
  fillMechanics();

  // Réactive les champs qui ont pu être verrouillés lors de l'ouverture d'une fiche.
  document.querySelectorAll('#repairForm input,#repairForm textarea,#repairForm select').forEach(el=>el.disabled=false);

  if(isManager()){
    $('assignedTo').value='';
  }else{
    // Une intervention créée par un mécanicien lui est automatiquement attribuée.
    $('assignedTo').value=currentUser.id;
    $('assignedTo').disabled=true;
    $('priority').disabled=true;
  }

  renderRepairParts();
  $('repairDialog').showModal();
}
window.openRepair=async id=>{
  const r=repairs.find(x=>x.id===id);if(!r)return;currentRepair=r;
  $('repairId').value=r.id;$('repairNoLabel').textContent=repairNo(r);
  ['company','equipment','brand','model','serial','fault','diagnostic','repair_done','notes'].forEach(k=>{const map={repair_done:'repairDone'};$(map[k]||k).value=r[k]||''});$('machineHours').value=(r.machine_hours??'');
  $('arrivalDate').value=r.arrival_date||'';$('departureDate').value=r.departure_date||'';$('hours').value=r.hours||'';$('priority').value=r.priority||'Normale';$('repairStatus').value=r.status||'En attente';fillMechanics();$('assignedTo').value=r.assigned_to||'';
  const editable=isManager()||r.assigned_to===currentUser.id;
  document.querySelectorAll('#repairForm input,#repairForm textarea,#repairForm select').forEach(el=>el.disabled=!editable&&el.id!=='repairId');
  if(!isManager()){$('assignedTo').disabled=true;$('priority').disabled=true;$('company').disabled=true}
  renderRepairParts();$('repairDialog').showModal();
}
async function saveRepair(e){
  e.preventDefault();
  const id=$('repairId').value||crypto.randomUUID();
  const payload={id,company:$('company').value,equipment:$('equipment').value.trim(),brand:$('brand').value.trim(),model:$('model').value.trim(),serial:$('serial').value.trim(),machine_hours:$('machineHours').value===''?null:Number($('machineHours').value),fault:$('fault').value.trim(),arrival_date:$('arrivalDate').value,diagnostic:$('diagnostic').value.trim(),repair_done:$('repairDone').value.trim(),hours:Number($('hours').value)||0,status:$('repairStatus').value,departure_date:$('departureDate').value||null,notes:$('notes').value.trim(),updated_by:currentUser.id};
  if(isManager()){
    payload.priority=$('priority').value;
    payload.assigned_to=$('assignedTo').value||null;
    if(!currentRepair)payload.created_by=currentUser.id;
  }else if(!currentRepair){
    // Le mécanicien peut créer une fiche uniquement pour lui-même.
    payload.priority='Normale';
    payload.assigned_to=currentUser.id;
    payload.created_by=currentUser.id;
  }
  let error;
  if(currentRepair){
    ({error}=await sb.from('repairs').update(payload).eq('id',id));
  }else{
    ({error}=await sb.from('repairs').insert(payload));
  }
  if(error)return alert('Enregistrement impossible : '+error.message);
  $('repairDialog').close();toast('Réparation enregistrée');await reloadAll();
}
function renderRepairParts(){
  if(!currentRepair){$('repairPartRequests').innerHTML='<div class="meta">Enregistrez d’abord la réparation pour ajouter une pièce.</div>';$('newPartRequestBtn').disabled=true;return}
  $('newPartRequestBtn').disabled=false;
  const rows=parts.filter(p=>p.repair_id===currentRepair.id);
  $('repairPartRequests').innerHTML=rows.length?rows.map(p=>`<article class="card"><div class="card-head"><div><h3>${esc(p.designation)}</h3><div class="meta">${esc(p.supplier||'Fournisseur non renseigné')} · réf. ${esc(p.reference||'—')} · Qté ${p.quantity}</div></div><span class="badge ${p.urgency==='Urgent'?'urgent':''}">${esc(p.status)}</span></div><div class="actions"><button type="button" class="secondary" onclick="openPart('${p.id}')">Ouvrir</button></div></article>`).join(''):'<div class="meta">Aucune demande de pièce.</div>';
}
function newPart(){
  if(!currentRepair)return;currentPartRepair=currentRepair;$('partForm').reset();$('partId').value='';$('partRepairLabel').textContent=repairNo(currentRepair)+' — '+currentRepair.equipment;$('partQty').value=1;$('partUrgency').value='Normal';$('partStatus').value=isManager()?'À commander':'À valider';$('partPhotoPreview').innerHTML='';$('partDialog').showModal();
}
window.openPart=async id=>{
  const p=parts.find(x=>x.id===id);if(!p)return;currentPartRepair=repairs.find(r=>r.id===p.repair_id)||null;
  $('partId').value=p.id;$('partRepairLabel').textContent=currentPartRepair?repairNo(currentPartRepair)+' — '+currentPartRepair.equipment:'';
  $('supplier').value=p.supplier||'';$('partReference').value=p.reference||'';$('partName').value=p.designation||'';$('partQty').value=p.quantity||1;$('partUrgency').value=p.urgency||'Normal';$('partStatus').value=p.status||'À valider';$('partUnitPrice').value=p.unit_price||'';$('partOrderDate').value=p.order_date||'';$('partReceivedDate').value=p.received_date||'';$('partOrderNo').value=p.purchase_order_no||'';$('partComment').value=p.comment||'';
  if(!isManager()){['partStatus','partUnitPrice','partOrderDate','partReceivedDate','partOrderNo'].forEach(id=>$(id).disabled=true)}else{['partStatus','partUnitPrice','partOrderDate','partReceivedDate','partOrderNo'].forEach(id=>$(id).disabled=false)}
  $('partPhotoPreview').innerHTML='';
  if(p.photo_path){const {data}=await sb.storage.from('parts-photos').createSignedUrl(p.photo_path,3600);if(data?.signedUrl)$('partPhotoPreview').innerHTML=`<img src="${data.signedUrl}" alt="Photo pièce">`}
  $('partDialog').showModal();
}
async function savePart(e){
  e.preventDefault();if(!currentPartRepair)return;
  const id=$('partId').value||crypto.randomUUID();
  let photoPath=parts.find(x=>x.id===id)?.photo_path||null;
  const file=$('partPhoto').files[0];
  if(file){const ext=(file.name.split('.').pop()||'jpg').toLowerCase(),path=`${currentPartRepair.id}/${id}.${ext}`;const {error:upErr}=await sb.storage.from('parts-photos').upload(path,file,{upsert:true});if(upErr)return alert('Photo non envoyée : '+upErr.message);photoPath=path}
  const payload={id,repair_id:currentPartRepair.id,requested_by:parts.find(x=>x.id===id)?.requested_by||currentUser.id,supplier:$('supplier').value.trim(),reference:$('partReference').value.trim(),designation:$('partName').value.trim(),quantity:Number($('partQty').value)||1,urgency:$('partUrgency').value,comment:$('partComment').value.trim(),photo_path:photoPath,updated_by:currentUser.id};
  if(isManager()){payload.status=$('partStatus').value;payload.unit_price=Number($('partUnitPrice').value)||0;payload.order_date=$('partOrderDate').value||null;payload.received_date=$('partReceivedDate').value||null;payload.purchase_order_no=$('partOrderNo').value.trim()}else if(!$('partId').value){payload.status='À valider'}
  let error;
  if($('partId').value){
    ({error}=await sb.from('part_requests').update(payload).eq('id',id));
  }else{
    ({error}=await sb.from('part_requests').insert(payload));
  }
  if(error)return alert('Demande impossible : '+error.message);
  $('partDialog').close();toast('Demande de pièce enregistrée');await reloadAll();renderRepairParts();
}
function renderParts(){
  const q=$('partSearch').value.trim().toLowerCase(),st=$('partStatusFilter').value,ur=$('partUrgencyFilter').value;
  let rows=parts.filter(p=>!st||p.status===st).filter(p=>!ur||p.urgency===ur).filter(p=>JSON.stringify(p).toLowerCase().includes(q)||profileName(p.requested_by).toLowerCase().includes(q));
  $('partList').innerHTML=rows.length?rows.map(p=>{const r=repairs.find(x=>x.id===p.repair_id);return `<article class="card ${p.urgency==='Urgent'?'priority-urgent':''}"><div class="card-head"><div><div class="number">${r?repairNo(r):''}</div><h3>${esc(p.designation)}</h3><div class="meta">${esc(p.supplier||'Fournisseur à préciser')} · réf. ${esc(p.reference||'—')} · Qté ${p.quantity}</div></div><span class="badge ${p.urgency==='Urgent'?'urgent':''}">${esc(p.status)}</span></div><div class="meta">${r?esc(r.company)+' · '+esc(r.equipment):''} · demandé par <strong>${esc(profileName(p.requested_by))}</strong></div><div class="actions"><button class="secondary" onclick="openPart('${p.id}')">Ouvrir</button></div></article>`}).join(''):'<div class="panel">Aucune demande de pièce.</div>';
}
function renderWorkshop(){
  if(!isManager())return;
  const priorities=['Urgent','Haute','Normale','Basse'];
  $('workshopBoard').innerHTML=priorities.map(pr=>{const rows=repairs.filter(r=>r.priority===pr&&!['Réparé','HS'].includes(r.status));return `<section class="kanban-col"><h3>${pr} (${rows.length})</h3>${rows.map(r=>`<article class="card priority-${slug(pr)}"><div class="number">${repairNo(r)}</div><strong>${esc(r.equipment)}</strong><div class="meta">${esc(profileName(r.assigned_to))}<br>${esc(r.status)}</div><button class="secondary" onclick="openRepair('${r.id}')">Ouvrir</button></article>`).join('')||'<div class="meta">Aucun dossier</div>'}</section>`}).join('');
}
function renderTeam(){
  if(!isManager())return;
  $('teamList').innerHTML=profiles.map(p=>`<article class="card"><div class="card-head"><div><h3>${esc(p.full_name||'Sans nom')}</h3><div class="meta">${esc(p.email||'')} · ${p.role==='manager'?'Gestionnaire':'Mécanicien'} · ${p.active?'Actif':'Inactif'}</div></div><button class="secondary" onclick="editProfile('${p.id}')">Modifier</button></div></article>`).join('');
}
window.editProfile=id=>{const p=profiles.find(x=>x.id===id);if(!p)return;$('profileId').value=p.id;$('profileName').value=p.full_name||'';$('profileRole').value=p.role||'mechanic';$('profileActive').value=String(p.active!==false);$('profileDialog').showModal()}
async function saveProfile(e){e.preventDefault();const {error}=await sb.from('profiles').update({full_name:$('profileName').value.trim(),role:$('profileRole').value,active:$('profileActive').value==='true'}).eq('id',$('profileId').value);if(error)return alert(error.message);$('profileDialog').close();await reloadAll()}
function reportRowsForCompany(company){
  const m=$('reportMonth').value;
  return repairs.filter(r=>r.company===company&&(r.departure_date||r.arrival_date||'').slice(0,7)===m);
}
function companyReport(company){
  const rows=reportRowsForCompany(company),rate=Number($('hourlyRate').value)||0;
  const totalHours=rows.reduce((s,r)=>s+(Number(r.hours)||0),0),ids=new Set(rows.map(r=>r.id));
  const validParts=parts.filter(p=>ids.has(p.repair_id)&&!['Annulée','À valider'].includes(p.status));
  const partsTotal=validParts.reduce((s,p)=>s+(Number(p.unit_price)||0)*(Number(p.quantity)||0),0),labor=rate*totalHours;
  return {company,rows,totalHours,partsTotal,labor,total:partsTotal+labor,validParts};
}
function refreshReport(){
  if(!isManager())return;
  const reports=ACCOUNTING_COMPANIES.map(companyReport);
  const totalInterventions=reports.reduce((s,x)=>s+x.rows.length,0),totalHours=reports.reduce((s,x)=>s+x.totalHours,0),totalParts=reports.reduce((s,x)=>s+x.partsTotal,0),totalLabor=reports.reduce((s,x)=>s+x.labor,0),totalGrand=totalParts+totalLabor;
  $('reportInterventions').textContent=totalInterventions;$('reportHours').textContent=hoursLabel(totalHours);$('reportParts').textContent=money(totalParts);$('reportLabor').textContent=money(totalLabor);$('reportGrand').textContent=money(totalGrand);
  $('companyReportBlocks').innerHTML=reports.map(x=>`<section class="company-report"><h3>${esc(x.company)}</h3><div class="company-totals"><article><span>Interventions</span><strong>${x.rows.length}</strong></article><article><span>Total heures</span><strong>${hoursLabel(x.totalHours)}</strong></article><article><span>Pièces HT</span><strong>${money(x.partsTotal)}</strong></article><article><span>Main-d’œuvre HT</span><strong>${money(x.labor)}</strong></article></div><div class="table-wrap"><table><thead><tr><th>N°</th><th>Date</th><th>Matériel</th><th>Compteur</th><th>Mécanicien</th><th>Heures</th><th>Pièces HT</th></tr></thead><tbody>${x.rows.map(r=>{const rp=x.validParts.filter(p=>p.repair_id===r.id),pc=rp.reduce((s,p)=>s+(Number(p.unit_price)||0)*(Number(p.quantity)||0),0);return `<tr><td>${repairNo(r)}</td><td>${frDate(r.departure_date||r.arrival_date)}</td><td>${esc(r.equipment)}</td><td>${r.machine_hours!=null?esc(r.machine_hours)+' h':'—'}</td><td>${esc(profileName(r.assigned_to))}</td><td>${hoursLabel(r.hours)}</td><td>${money(pc)}</td></tr>`}).join('')}</tbody></table></div></section>`).join('');
  return {reports,totalInterventions,totalHours,totalParts,totalLabor,totalGrand,month:$('reportMonth').value};
}
function reportText(){
  const x=refreshReport();let text=`JUSTEAU SAV — RÉCAPITULATIF MENSUEL\nMois : ${x.month}\n\n`;
  x.reports.forEach(r=>{text+=`${r.company}\nInterventions : ${r.rows.length}\nTotal heures : ${hoursLabel(r.totalHours)}\nPièces HT : ${money(r.partsTotal)}\n`;if((Number($('hourlyRate').value)||0)>0)text+=`Main-d’œuvre HT : ${money(r.labor)}\n`;text+='\n'});
  text+=`TOTAL GÉNÉRAL\nInterventions : ${x.totalInterventions}\nHeures : ${hoursLabel(x.totalHours)}\nPièces HT : ${money(x.totalParts)}\n`;if((Number($('hourlyRate').value)||0)>0)text+=`Main-d’œuvre HT : ${money(x.totalLabor)}\n`;text+=`TOTAL HT : ${money(x.totalGrand)}`;return text;
}
async function shareReport(){const text=reportText();if(navigator.share)await navigator.share({title:'Justeau SAV — Récap mensuel',text});else if(navigator.clipboard){await navigator.clipboard.writeText(text);toast('Récapitulatif copié')}}
function emailReport(){const x=refreshReport(),subject=`Justeau SAV - Récapitulatif ${x.month} - Justeau Frères / SECA / SAS Havard`,body=reportText();location.href=`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
async function shareApp(){const data={title:'Justeau SAV',text:'Application Justeau SAV',url:location.origin+location.pathname};if(navigator.share)await navigator.share(data);else if(navigator.clipboard){await navigator.clipboard.writeText(data.url);toast('Lien copié')}}
function switchView(name){document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view===name));$('view-'+name).classList.add('active');if(name==='report')refreshReport()}
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>switchView(t.dataset.view));
$('saveServerBtn').onclick=saveServer;$('clearServerBtn').onclick=clearServer;$('loginBtn').onclick=login;$('logoutBtn').onclick=logout;$('shareBtn').onclick=shareApp;
$('newRepairBtn').onclick=newRepair;$('repairForm').onsubmit=saveRepair;$('closeRepairDialog').onclick=()=>$('repairDialog').close();$('newPartRequestBtn').onclick=newPart;$('partForm').onsubmit=savePart;$('closePartDialog').onclick=()=>$('partDialog').close();$('profileForm').onsubmit=saveProfile;$('closeProfileDialog').onclick=()=>$('profileDialog').close();
['repairSearch','repairStatusFilter','repairPriorityFilter'].forEach(id=>$(id).oninput=renderRepairs);['partSearch','partStatusFilter','partUrgencyFilter'].forEach(id=>$(id).oninput=renderParts);['reportMonth','hourlyRate'].forEach(id=>$(id).oninput=refreshReport);
$('printReportBtn').onclick=()=>window.print();$('shareReportBtn').onclick=shareReport;$('emailReportBtn').onclick=emailReport;
$('reportMonth').value=new Date().toISOString().slice(0,7);
boot();