'use strict';
const $=id=>document.getElementById(id),sb=window.sbClient,workspace=window.WORKSPACE_ID;
const uuid=()=>crypto.randomUUID(),bucket=()=>sb.storage.from('workshop-files');
let user=null,generation=0,ready=false,loading=false,refreshAgain=false;
let state={nodes:[],links:[],messages:[],documents:[]};
let scale=1,px=0,py=0,source=null,channel=null,poll=null,refreshTimer=null;
const cards=new Map(),expanded=new Set(),drafts=new Map(),readJobs=new Map(),messageDrafts=new Map(),pendingFiles=new Set();
let localFiles=[],localDB=null;
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error)}
function check(r){if(r.error)throw r.error;return r.data}
function failure(error,text){console.error(text,error);status(text+(error?.message?' '+error.message:''),true)}
function element(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el}
function action(text,fn,cls=''){const b=element('button',cls,text);b.type='button';b.onclick=fn;return b}
function dateLabel(v){const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'})}
function sizeLabel(b){return b<1024?b+' o':b<1048576?(b/1024).toFixed(1)+' Ko':(b/1048576).toFixed(1)+' Mo'}
function transform(){$('world').style.transform=`translate(${px}px,${py}px) scale(${scale})`;$('zoomValue').textContent=Math.round(scale*100)+'%'}
function setEnabled(enabled){['add','importButton','export'].forEach(id=>$(id).disabled=!enabled)}

// One consistent server snapshot includes the revision actually displayed to the user.
async function refresh({fit=false}={}){
  if(!user)return;if(loading){refreshAgain=true;return}loading=true;const token=generation;
  try{const snapshot=check(await sb.rpc('workshop_snapshot',{p_workspace_id:workspace}));if(token!==generation)return;
    if(snapshot?.version!==2)throw Error('Appliquez la migration 001_case_collaboration.sql.');
    state=snapshot;
    state.nodes.forEach(n=>{const d=drafts.get(n.id);if(d)Object.assign(n,d.fields);const c=cards.get(n.id);if(c?.dataset.dragging){n.x=parseFloat(c.style.left);n.y=parseFloat(c.style.top)}});
    ready=true;setEnabled(true);render();if(fit)fitAll();
    if(!$('status').classList.contains('error'))status('Espace partagé à jour. Orange : activité non consultée.');
  }catch(error){if(token!==generation)return;if(!ready)failure(error,'Chargement impossible. Vérifiez la migration Supabase et votre accès.');else status('Synchronisation interrompue. Nouvel essai automatique ; vos brouillons sont conservés.',true)}
  finally{if(token===generation){loading=false;if(refreshAgain){refreshAgain=false;queueRefresh()}}}
}
function queueRefresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refresh(),180)}
async function markRead(id){
  const n=state.nodes.find(n=>n.id===id);if(!n||!user||readJobs.has(id))return;
  const revision=n.activity_revision,token=generation;readJobs.set(id,true);
  try{check(await sb.rpc('workshop_mark_read',{p_node_id:id,p_revision:revision}));if(token!==generation)return;
    const current=state.nodes.find(n=>n.id===id);if(current&&current.activity_revision<=revision){current.unread=false;paintCard(current)}queueRefresh();
  }catch(error){if(token===generation)failure(error,'Lecture non enregistrée.')}finally{if(token===generation)readJobs.delete(id)}
}
function openCard(id,open=true){if(open){expanded.add(id);markRead(id)}else expanded.delete(id);paintCard(state.nodes.find(n=>n.id===id));draw()}

function draftNode(id,patch){let d=drafts.get(id);if(!d){d={fields:{},version:0,timer:null,sending:false};drafts.set(id,d)}
  Object.assign(d.fields,patch);d.version++;clearTimeout(d.timer);const n=state.nodes.find(n=>n.id===id);if(n)Object.assign(n,patch);
  d.timer=setTimeout(()=>flushNode(id),500);status('Modification en cours…');
}
async function flushNode(id){
  const d=drafts.get(id);if(!d||d.sending||!user)return;d.sending=true;clearTimeout(d.timer);
  const token=generation,version=d.version,fields={...d.fields};
  try{
    // Send only changed fields. Moving a card never sends stale title/body fields.
    const rows=check(await sb.from('nodes').update(fields).eq('id',id).eq('workspace_id',workspace).select('id'));
    if(!rows?.length)throw Error('Case supprimée ou accès refusé.');if(token!==generation)return;
    if(d.version===version)drafts.delete(id);else for(const [key,value]of Object.entries(fields))if(d.fields[key]===value)delete d.fields[key];
    status('Modifications sauvegardées.');queueRefresh();
  }catch(error){if(token===generation)failure(error,'Sauvegarde impossible. Brouillon conservé ; cliquez sur Réessayer.')}
  finally{d.sending=false;if(token===generation&&drafts.has(id)&&d.version!==version)d.timer=setTimeout(()=>flushNode(id),50)}
}

function makeCard(n){
  const card=element('article','node');card.dataset.nodeId=n.id;
  card.innerHTML=`<div class="node-head"><button type="button" class="handle" aria-label="Déplacer cette case">☰</button><h2 class="node-title"></h2><button type="button" class="delete-node" aria-label="Supprimer cette case">×</button></div>
    <button type="button" class="unread-label">Nouveauté · marquer consultée</button><p class="node-preview"></p>
    <div class="node-actions"><button type="button" class="open-node" aria-expanded="false">Ouvrir</button><button type="button" class="link">Relier</button></div>
    <div class="node-content" hidden><label>Titre<input class="edit-title" maxlength="250"></label><label>Notes, formules et décisions<textarea class="edit-body" rows="6"></textarea></label>
    <details class="discussion"><summary>Discussion</summary><div class="thread" aria-live="polite"></div><form class="message-form"><textarea rows="2" maxlength="10000" aria-label="Nouveau message" placeholder="Écrire dans cette discussion…" required></textarea><button type="submit">Envoyer</button></form></details>
    <details class="documents"><summary>Documents</summary><label class="drop-zone">Déposer des fichiers ici ou choisir<input class="file-input" type="file" multiple></label><small>20 Mo maximum par fichier</small><div class="file-list"></div><div class="legacy-list"></div></details></div>`;
  const title=card.querySelector('.edit-title'),body=card.querySelector('.edit-body');
  title.oninput=()=>draftNode(n.id,{title:title.value});body.oninput=()=>draftNode(n.id,{body:body.value});
  card.querySelector('.open-node').onclick=()=>openCard(n.id,!expanded.has(n.id));
  card.querySelector('.unread-label').onclick=()=>{expanded.add(n.id);markRead(n.id);paintCard(state.nodes.find(v=>v.id===n.id))};
  card.querySelector('.delete-node').onclick=()=>deleteNode(n.id);card.querySelector('.link').onclick=()=>linkNode(n.id);
  card.querySelectorAll('details').forEach(d=>d.addEventListener('toggle',draw));
  const form=card.querySelector('.message-form'),input=form.querySelector('textarea');input.value=messageDrafts.get(n.id)||'';
  input.oninput=()=>{if(input.value)messageDrafts.set(n.id,input.value);else messageDrafts.delete(n.id)};
  form.onsubmit=async e=>{e.preventDefault();const text=input.value.trim();if(!text||!user)return;
    const button=form.querySelector('button');if(button.disabled)return;button.disabled=true;const token=generation;
    try{check(await sb.from('messages').insert({id:uuid(),workspace_id:workspace,node_id:n.id,body:text,created_by:user.id}));if(token!==generation)return;
      if(input.value.trim()===text){input.value='';messageDrafts.delete(n.id)}status('Message envoyé dans cette case.');queueRefresh();
    }catch(error){if(token===generation)failure(error,'Message non envoyé. Votre texte est conservé.')}finally{button.disabled=false}
  };
  const fi=card.querySelector('.file-input'),drop=card.querySelector('.drop-zone');
  fi.onchange=()=>{uploadFiles(n.id,[...fi.files]);fi.value=''};drop.ondragover=e=>{e.preventDefault();drop.classList.add('dragover')};drop.ondragleave=()=>drop.classList.remove('dragover');
  drop.ondrop=e=>{e.preventDefault();drop.classList.remove('dragover');uploadFiles(n.id,[...e.dataTransfer.files])};
  attachDrag(card,n.id);cards.set(n.id,card);$('nodes').append(card);return card;
}
function paintCard(n){
  if(!n)return;const card=cards.get(n.id)||makeCard(n),open=expanded.has(n.id);
  card.classList.toggle('unread',!!n.unread);card.classList.toggle('selected',source===n.id);card.classList.toggle('expanded',open);
  if(!card.dataset.dragging){card.style.left=n.x+'px';card.style.top=n.y+'px'}
  card.querySelector('.node-title').textContent=n.title||'Sans titre';card.querySelector('.node-preview').textContent=n.body?.trim().slice(0,110)||'Notes, discussion et documents';
  card.querySelector('.node-preview').hidden=open;card.querySelector('.unread-label').hidden=!n.unread;
  const opener=card.querySelector('.open-node');opener.textContent=open?'Replier':'Ouvrir';opener.setAttribute('aria-expanded',String(open));card.querySelector('.node-content').hidden=!open;
  const title=card.querySelector('.edit-title'),body=card.querySelector('.edit-body');if(document.activeElement!==title)title.value=n.title;if(document.activeElement!==body)body.value=n.body;
  const messages=state.messages.filter(m=>m.node_id===n.id),docs=state.documents.filter(d=>d.node_id===n.id);
  card.querySelector('.discussion summary').textContent='Discussion · '+messages.length;card.querySelector('.documents summary').textContent='Documents · '+docs.length;
  const thread=card.querySelector('.thread'),signature=JSON.stringify(messages);
  if(thread.dataset.signature!==signature){const atBottom=thread.scrollHeight-thread.scrollTop-thread.clientHeight<35;thread.replaceChildren();
    if(!messages.length)thread.append(element('p','empty','Aucun message dans cette case.'));
    for(const m of messages){const entry=element('article','message');entry.append(element('div','message-meta',(m.author_label||'Membre')+' · '+dateLabel(m.created_at)),element('p','',m.body));thread.append(entry)}
    thread.dataset.signature=signature;if(atBottom)thread.scrollTop=thread.scrollHeight;
  }
  const list=card.querySelector('.file-list'),ds=JSON.stringify(docs);
  if(list.dataset.signature!==ds){list.replaceChildren();if(!docs.length)list.append(element('p','empty','Aucun document dans cette case.'));
    for(const doc of docs){const row=element('div','file');row.append(element('strong','filename',doc.name),element('small','',sizeLabel(doc.size)+' · '+(doc.author_label||'Membre')+' · '+dateLabel(doc.created_at)));
      const buttons=element('div','file-actions');buttons.append(action('Télécharger',()=>downloadDocument(doc)),action('Supprimer',()=>deleteDocument(doc),'quiet'));row.append(buttons);list.append(row)}list.dataset.signature=ds;
  }
  card.querySelector('.file-input').disabled=pendingFiles.has(n.id);
  const legacy=card.querySelector('.legacy-list');
  if(legacy.dataset.ids!==localFiles.map(f=>f.id).join(',')){legacy.replaceChildren();legacy.dataset.ids=localFiles.map(f=>f.id).join(',');
    if(localFiles.length){legacy.append(element('p','','Anciens fichiers sur cet appareil : rattachez-les à cette case. Les originaux locaux seront conservés.'));
      for(const f of localFiles){const line=element('div','file');line.append(element('span','filename',f.file.name),action('Rattacher ici',()=>uploadFiles(n.id,[f.file])),action('Télécharger la copie locale',()=>download(f.file,f.file.name),'quiet'));legacy.append(line)}}
  }
}
function render(){const ids=new Set(state.nodes.map(n=>n.id));for(const[id,card]of cards)if(!ids.has(id)){
  const d=drafts.get(id);if(d){clearTimeout(d.timer);status('Une case a été supprimée pendant votre modification. Exportez vos brouillons avant de quitter.',true)}
  card.remove();cards.delete(id);expanded.delete(id);if(source===id)source=null;
}state.nodes.forEach(paintCard);draw();$('emptyBoard').hidden=state.nodes.length>0;$('unreadCount').textContent=state.nodes.filter(n=>n.unread).length+' case(s) à consulter'}
function draw(){$('lines').replaceChildren();for(const l of state.links){const a=state.nodes.find(n=>n.id===l.source_id),b=state.nodes.find(n=>n.id===l.target_id);if(!a||!b)continue;
  const ca=cards.get(a.id),cb=cards.get(b.id),path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',`M ${a.x+180} ${a.y+(ca?.offsetHeight||160)/2} L ${b.x+180} ${b.y+(cb?.offsetHeight||160)/2}`);path.setAttribute('class','connection');path.onpointerdown=e=>e.stopPropagation();path.onclick=async()=>{
    if(!confirm('Supprimer ce lien ?'))return;try{check(await sb.from('links').delete().eq('id',l.id).eq('workspace_id',workspace));queueRefresh()}catch(error){failure(error,'Lien non supprimé.')}
  };$('lines').append(path)}}
async function deleteNode(id){if(state.documents.some(d=>d.node_id===id)){status('Supprimez les documents de cette case avant de supprimer la case.');return}
  if(!confirm('Supprimer cette case et sa discussion pour tous les participants ?'))return;const token=generation;
  try{const rows=check(await sb.from('nodes').delete().eq('id',id).eq('workspace_id',workspace).select('id'));if(!rows?.length)throw Error('Case absente ou accès refusé.');if(token!==generation)return;
    const d=drafts.get(id);if(d)clearTimeout(d.timer);drafts.delete(id);messageDrafts.delete(id);queueRefresh();
  }catch(error){if(token===generation)failure(error,'Suppression impossible.')}
}
let linking=false;
async function linkNode(id){if(!source){source=id;render();status('Choisissez Relier sur la case de destination.');return}if(source===id){source=null;render();return}if(linking)return;linking=true;const from=source,token=generation;
  try{if(!state.links.some(l=>(l.source_id===from&&l.target_id===id)||(l.source_id===id&&l.target_id===from)))check(await sb.from('links').insert({id:uuid(),workspace_id:workspace,source_id:from,target_id:id,created_by:user.id}));if(token!==generation)return;source=null;render();queueRefresh();
  }catch(error){if(token===generation)failure(error,'Lien non créé.')}finally{linking=false}
}

async function uploadFiles(nodeId,files){if(!ready||!user||pendingFiles.has(nodeId))return;pendingFiles.add(nodeId);paintCard(state.nodes.find(n=>n.id===nodeId));const token=generation;
  try{for(const file of files){if(token!==generation)return;if(file.size>20*1024*1024)throw Error(file.name+' dépasse 20 Mo.');if(file.name.length>500)throw Error('Nom de fichier trop long.');
    const id=uuid(),path=workspace+'/'+nodeId+'/'+id;status('Envoi de '+file.name+'…');check(await bucket().upload(path,file,{upsert:false,contentType:file.type||'application/octet-stream'}));
    try{check(await sb.rpc('workshop_register_document',{p_node_id:nodeId,p_id:id,p_name:file.name,p_size:file.size,p_mime_type:file.type||'application/octet-stream'}))}
    catch(error){
      // A lost RPC response may hide a successful commit: check before compensating.
      const registered=await sb.from('workshop_documents').select('id').eq('id',id).maybeSingle();
      if(registered.error)throw Error('État de l’envoi incertain. Actualisez avant de réenvoyer le fichier.');
      if(!registered.data){const cleanup=await bucket().remove([path]);if(cleanup.error)error.message+=' (Nettoyage à reprendre dans Storage : '+path+')';throw error}
    }
    if(token!==generation)return;status('Document partagé dans la case.');await refresh();
  }}catch(error){if(token===generation)failure(error,'Envoi interrompu. Les fichiers déjà envoyés sont conservés.')}
  finally{if(token===generation){pendingFiles.delete(nodeId);paintCard(state.nodes.find(n=>n.id===nodeId));queueRefresh()}}
}
async function downloadDocument(doc){try{download(check(await bucket().download(doc.storage_path)),doc.name)}catch(error){failure(error,'Téléchargement impossible.')}}
const deletingDocuments=new Set();
async function deleteDocument(doc){if(deletingDocuments.has(doc.id)||!confirm('Supprimer « '+doc.name+' » pour tous les participants ?'))return;deletingDocuments.add(doc.id);
  try{check(await bucket().remove([doc.storage_path]));check(await sb.rpc('workshop_remove_document',{p_id:doc.id}));status('Document supprimé.');queueRefresh()}
  catch(error){failure(error,'Suppression incomplète. Réessayez Supprimer pour terminer.')}finally{deletingDocuments.delete(doc.id)}
}
function download(blob,name){const url=URL.createObjectURL(blob),a=element('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
// Read old IndexedDB files, never silently delete or upload them.
function loadLocalDocuments(){try{const request=indexedDB.open('workshop-documents',1);request.onupgradeneeded=()=>request.result.createObjectStore('files',{keyPath:'id'});
  request.onsuccess=()=>{localDB=request.result;if(!localDB.objectStoreNames.contains('files'))return;const get=localDB.transaction('files').objectStore('files').getAll();get.onsuccess=()=>{localFiles=get.result||[];if(user)render()}};
}catch(error){console.warn('Anciens fichiers locaux indisponibles.',error)}}

function attachDrag(card,id){const handle=card.querySelector('.handle');let drag=null;
  handle.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();handle.setPointerCapture(e.pointerId);drag={pointer:e.pointerId,x:e.clientX,y:e.clientY};card.dataset.dragging='true'};
  handle.onpointermove=e=>{if(!drag||drag.pointer!==e.pointerId)return;const n=state.nodes.find(n=>n.id===id);if(!n)return;n.x+=(e.clientX-drag.x)/scale;n.y+=(e.clientY-drag.y)/scale;drag.x=e.clientX;drag.y=e.clientY;card.style.left=n.x+'px';card.style.top=n.y+'px';draw()};
  const end=e=>{if(!drag||drag.pointer!==e.pointerId)return;drag=null;delete card.dataset.dragging;const n=state.nodes.find(n=>n.id===id);if(n)draftNode(id,{x:parseFloat(card.style.left),y:parseFloat(card.style.top)})};handle.onpointerup=handle.onpointercancel=handle.onlostpointercapture=end;
}
const pointers=new Map();let previous=null;
function gesture(){const p=[...pointers.values()];return p.length===1?{x:p[0].x,y:p[0].y,d:0}:{x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2,d:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)}}
$('view').onpointerdown=e=>{if(e.target.closest('.node')||e.button!==0)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});$('view').setPointerCapture(e.pointerId);previous=gesture()};
$('view').onpointermove=e=>{if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const g=gesture();if(previous){px+=g.x-previous.x;py+=g.y-previous.y;if(g.d&&previous.d)zoom(scale*g.d/previous.d,g.x,g.y);transform()}previous=g};
function endPointer(e){pointers.delete(e.pointerId);previous=pointers.size?gesture():null}$('view').onpointerup=$('view').onpointercancel=endPointer;
function zoom(s,x,y){s=Math.max(.15,Math.min(3,s));const r=$('view').getBoundingClientRect(),a=x-r.left,b=y-r.top;px=a-(a-px)*s/scale;py=b-(b-py)*s/scale;scale=s;transform()}
$('view').addEventListener('wheel',e=>{if(e.target.closest('textarea,.thread,.file-list'))return;e.preventDefault();zoom(scale*Math.exp(-e.deltaY*.0015),e.clientX,e.clientY)},{passive:false});
function zoomStep(f){const r=$('view').getBoundingClientRect();zoom(scale*f,r.left+r.width/2,r.top+r.height/2)}$('plus').onclick=()=>zoomStep(1.2);$('minus').onclick=()=>zoomStep(1/1.2);
function fitAll(){if(!state.nodes.length)return;const x=Math.min(...state.nodes.map(n=>n.x)),y=Math.min(...state.nodes.map(n=>n.y)),w=Math.max(...state.nodes.map(n=>n.x+360))-x,h=Math.max(...state.nodes.map(n=>n.y+(cards.get(n.id)?.offsetHeight||200)))-y;
  scale=Math.max(.15,Math.min(1,($('view').clientWidth-50)/w,($('view').clientHeight-50)/h));px=($('view').clientWidth-w*scale)/2-x*scale;py=($('view').clientHeight-h*scale)/2-y*scale;transform()}
$('fit').onclick=fitAll;
$('add').onclick=async()=>{if(!ready)return;const button=$('add');button.disabled=true;const token=generation;
  try{const id=uuid();check(await sb.from('nodes').insert({id,workspace_id:workspace,x:($('view').clientWidth/2-px)/scale-180,y:($('view').clientHeight/2-py)/scale-100,title:'Nouvelle case',body:'Notes :\n\nFormules / valeurs :\n\nDécisions :',created_by:user.id}));if(token!==generation)return;expanded.add(id);await refresh();
  }catch(error){if(token===generation)failure(error,'Case non créée.')}finally{if(token===generation)button.disabled=!ready}
};
$('retry').onclick=()=>{status('Nouvel essai…');for(const id of drafts.keys())flushNode(id);refresh()};
$('export').onclick=()=>{const data={version:2,nodes:state.nodes.map(n=>({id:n.id,x:n.x,y:n.y,title:n.title,body:n.body})),links:state.links.map(l=>[l.source_id,l.target_id]),messages:state.messages.map(m=>({node_id:m.node_id,body:m.body,author_label:m.author_label,created_at:m.created_at})),documents:state.documents,unsaved_drafts:[...drafts].map(([id,d])=>({id,...d.fields})),message_drafts:[...messageDrafts].map(([node_id,body])=>({node_id,body}))};
  download(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'workshop.json');status('Tableau exporté. Téléchargez les fichiers séparément ; ils ne sont pas inclus dans le JSON.');
};
$('importButton').onclick=()=>$('import').click();$('import').onchange=async e=>{const token=generation;
  try{const file=e.target.files[0];if(!file||!ready)return;if(file.size>10*1024*1024)throw Error('Fichier JSON trop volumineux.');const data=JSON.parse(await file.text());
    if(!confirm('Ajouter les cases et discussions de ce fichier ? Les cases existantes seront conservées. Les fichiers devront être déposés séparément.'))return;
    check(await sb.rpc('workshop_import',{p_workspace_id:workspace,p_data:data}));if(token!==generation)return;await refresh({fit:true});status('Cases et discussions importées. Les messages importés portent votre nom.');
  }catch(error){if(token===generation)failure(error,'Import annulé : aucune modification partielle n’est conservée.')}finally{e.target.value=''}
};

async function start(userInfo){if(user?.id===userInfo.id)return;stop();user=userInfo;const token=generation;status('Chargement de votre espace…');await refresh({fit:true});if(token!==generation)return;
  channel=sb.channel('workshop-cases-'+workspace+'-'+user.id);
  // Events invalidate the snapshot. Never trust DELETE filters for workspace isolation.
  for(const table of ['nodes','links','messages','workshop_documents','workshop_node_reads'])channel.on('postgres_changes',{event:'*',schema:'public',table},queueRefresh);
  channel.subscribe(s=>{if(s==='SUBSCRIBED')queueRefresh()});poll=setInterval(()=>{if(!document.hidden)refresh()},10000);
}
function stop(){generation++;user=null;ready=false;setEnabled(false);clearInterval(poll);clearTimeout(refreshTimer);if(channel)sb.removeChannel(channel);channel=null;
  for(const d of drafts.values())clearTimeout(d.timer);drafts.clear();messageDrafts.clear();readJobs.clear();pendingFiles.clear();expanded.clear();pointers.clear();previous=null;source=null;loading=false;refreshAgain=false;
  state={nodes:[],links:[],messages:[],documents:[]};render();
}
window.workshop={start,stop,hasPending:()=>drafts.size>0||messageDrafts.size>0||pendingFiles.size>0};
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&user)queueRefresh()});window.addEventListener('online',()=>{if(user)queueRefresh()});
window.addEventListener('beforeunload',e=>{if(window.workshop.hasPending()){e.preventDefault();e.returnValue=''}});
setEnabled(false);render();transform();loadLocalDocuments();
