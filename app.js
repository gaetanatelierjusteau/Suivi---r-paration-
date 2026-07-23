const OLD_KEY='justeau-sav-simple-v1';
const DB_NAME='justeau-sav-v2';
const STORE='repairs';
const $=id=>document.getElementById(id);
let db, data=[], currentPhotos=[];

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>req.result.createObjectStore(STORE,{keyPath:'id'});
    req.onsuccess=()=>{db=req.result;resolve(db)};
    req.onerror=()=>reject(req.error);
  });
}
function tx(mode='readonly'){return db.transaction(STORE,mode).objectStore(STORE)}
function getAll(){return new Promise((res,rej)=>{const r=tx().getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function put(r){return new Promise((res,rej)=>{const q=tx('readwrite').put(r);q.onsuccess=()=>res();q.onerror=()=>rej(q.error)})}
function remove(id){return new Promise((res,rej)=>{const q=tx('readwrite').delete(id);q.onsuccess=()=>res();q.onerror=()=>rej(q.error)})}
function clearStore(){return new Promise((res,rej)=>{const q=tx('readwrite').clear();q.onsuccess=()=>res();q.onerror=()=>rej(q.error)})}

function repairNum(r){return 'R-'+String(r.seq||0).padStart(6,'0')}
function slug(s){return (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function frDate(v){if(!v)return '';const [y,m,d]=v.split('-');return `${d}/${m}/${y}`}

async function migrate(){
  const old=JSON.parse(localStorage.getItem(OLD_KEY)||'[]');
  if(!old.length || (await getAll()).length) return;
  for(const r of old){
    await put({...r,mechanic:r.mechanic||'Gaetan',status:mapOldStatus(r.status),photos:r.photos||[]});
  }
}
function mapOldStatus(s){
  if(['Terminé','Restitué'].includes(s))return 'Réparé';
  if(s==='Attente pièces')return 'Pièce en commande';
  return 'En attente';
}
async function reload(){data=await getAll();render()}

function render(){
  const query=$('q').value.trim().toLowerCase();
  const filter=$('statusFilter').value;
  const rows=[...data]
    .filter(r=>!filter||r.status===filter)
    .filter(r=>JSON.stringify({...r,photos:[]}).toLowerCase().includes(query))
    .sort((a,b)=>(b.arrival||'').localeCompare(a.arrival||'')||(b.seq||0)-(a.seq||0));

  $('total').textContent=data.length;
  $('pending').textContent=data.filter(r=>r.status!=='Réparé'&&r.status!=='HS').length;
  $('repaired').textContent=data.filter(r=>r.status==='Réparé').length;

  $('list').innerHTML=rows.length?rows.map(r=>`
    <article class="card status-${slug(r.status)}">
      <div class="card-top">
        <div>
          <div class="number">${repairNum(r)}</div>
          <h3>${esc(r.equipment||'Matériel non renseigné')}</h3>
        </div>
        <span class="badge">${esc(r.status)}</span>
      </div>
      <div class="meta">${esc(r.company)}${r.arrival?' · arrivée '+frDate(r.arrival):''}</div>
      <div class="meta">${esc([r.first,r.last].filter(Boolean).join(' '))}${r.serial?' · série/parc '+esc(r.serial):''}</div>
      <div class="fault"><strong>Panne :</strong> ${esc(r.fault||'—')}</div>
      <div class="actions">
        <button class="secondary" onclick="editRepair('${r.id}')">Ouvrir / modifier</button>
        <button class="ghost" onclick="printRepair('${r.id}')">Fiche PDF</button>
        <button class="danger" onclick="deleteRepair('${r.id}')">Supprimer</button>
      </div>
    </article>`).join(''):'<div class="empty">Aucune réparation trouvée.</div>';
}
function resetForm(){
  $('repairForm').reset();$('id').value='';$('arrival').value=new Date().toISOString().slice(0,10);
  $('status').value='En attente';$('mechanic').value='Gaetan';currentPhotos=[];renderPhotos();
}
function newRepair(){
  resetForm();$('dialogTitle').textContent='Nouvelle réparation';$('repairNumber').textContent='Numéro attribué à l’enregistrement';
  $('repairDialog').showModal();
}
function fillForm(r){
  const keys=['id','company','first','last','phone','equipment','brand','model','serial','fault','arrival','diagnostic','repair','parts','hours','mechanic','status','departure','notes'];
  keys.forEach(k=>$(k).value=r[k]||'');
  currentPhotos=[...(r.photos||[])];renderPhotos();
}
window.editRepair=id=>{
  const r=data.find(x=>x.id===id);if(!r)return;
  fillForm(r);$('dialogTitle').textContent='Fiche de réparation';$('repairNumber').textContent=repairNum(r);$('repairDialog').showModal();
}
window.deleteRepair=async id=>{
  if(confirm('Supprimer définitivement cette réparation ?')){await remove(id);await reload()}
}
window.printRepair=id=>{editRepair(id);setTimeout(()=>window.print(),250)}

function renderPhotos(){
  $('photoPreview').innerHTML=currentPhotos.map((src,i)=>`<div class="photo-item"><img src="${src}" alt="Photo réparation"><button type="button" onclick="removePhoto(${i})">×</button></div>`).join('');
}
window.removePhoto=i=>{currentPhotos.splice(i,1);renderPhotos()}
function compressImage(file){
  return new Promise((resolve,reject)=>{
    const img=new Image(), reader=new FileReader();
    reader.onload=()=>img.src=reader.result;reader.onerror=reject;
    img.onload=()=>{
      const max=1400, scale=Math.min(1,max/Math.max(img.width,img.height));
      const c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL('image/jpeg',.76));
    };img.onerror=reject;reader.readAsDataURL(file);
  });
}
$('photos').addEventListener('change',async e=>{
  for(const f of [...e.target.files]) currentPhotos.push(await compressImage(f));
  e.target.value='';renderPhotos();
});

$('repairForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const rid=$('id').value||crypto.randomUUID();
  const old=data.find(x=>x.id===rid);
  const nextSeq=old?.seq||Math.max(0,...data.map(x=>Number(x.seq)||0))+1;
  const keys=['company','first','last','phone','equipment','brand','model','serial','fault','arrival','diagnostic','repair','parts','hours','mechanic','status','departure','notes'];
  const r={id:rid,seq:nextSeq,photos:currentPhotos,updatedAt:new Date().toISOString()};
  keys.forEach(k=>r[k]=$(k).value.trim?.()??$(k).value);
  await put(r);$('repairDialog').close();await reload();
});
$('printBtn').onclick=()=>window.print();
$('newBtn').onclick=newRepair;
$('closeDialog').onclick=$('cancelBtn').onclick=()=>$('repairDialog').close();
$('q').addEventListener('input',render);$('statusFilter').addEventListener('change',render);

$('menuBtn').onclick=()=>$('menuDialog').showModal();
$('closeMenu').onclick=()=>$('menuDialog').close();
$('exportBtn').onclick=()=>{
  const blob=new Blob([JSON.stringify({version:2,exportedAt:new Date().toISOString(),repairs:data},null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`sauvegarde-justeau-sav-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);
};
$('importFile').addEventListener('change',async e=>{
  try{
    const obj=JSON.parse(await e.target.files[0].text()), rows=Array.isArray(obj)?obj:obj.repairs;
    if(!Array.isArray(rows))throw new Error();
    if(!confirm(`Importer ${rows.length} réparation(s) ? Les données actuelles seront remplacées.`))return;
    await clearStore();for(const r of rows)await put(r);await reload();$('menuDialog').close();
  }catch{alert('Ce fichier de sauvegarde n’est pas valide.')}
  e.target.value='';
});

(async()=>{
  await openDB();await migrate();await reload();
  if('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js');
})();