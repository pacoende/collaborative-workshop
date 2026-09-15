import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('..',import.meta.url));
const server=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;const filename=path.join(root,p==='/'?'index.html':p);if(!filename.startsWith(root))throw Error();
  res.setHeader('Content-Type',filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html');res.end(await readFile(filename));
}catch{res.statusCode=404;res.end('not found')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let options={headless:true};
if(process.env.WORKSHOP_CHROMIUM_PACKAGE){const {default:c}=await import(process.env.WORKSHOP_CHROMIUM_PACKAGE);options={...options,executablePath:process.env.WORKSHOP_CHROMIUM_PATH||await c.executablePath(),args:c.args.filter(a=>!a.includes('disable-web-security'))};}
const browser=await chromium.launch(options);
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:''}));
await context.addInitScript(()=>{
  const A='alice',B='bob';let current=A;
  const data={version:2,nodes:[{id:'n1',workspace_id:'w',title:'Budget',body:'Hypothèses du budget',x:30,y:30,activity_revision:0,unread:false},{id:'n2',workspace_id:'w',title:'Communication',body:'Autre sujet',x:560,y:30,activity_revision:0,unread:false}],links:[],messages:[],documents:[]};
  const activity={},reads={},files=new Map(),calls=[];let failMessages=false,failSave=false,failRegistration=false;
  function touch(id,actor){const n=data.nodes.find(n=>n.id===id);if(!n)return;n.activity_revision++;(activity[id]??={})[actor]=n.activity_revision;}
  function snapshot(){const s=structuredClone(data);s.nodes.forEach(n=>n.unread=Object.entries(activity[n.id]||{}).some(([actor,rev])=>actor!==current&&rev>(reads[current+':'+n.id]||0)));return s;}
  function query(table){let mode='select',payload=null,filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},update(v){mode='update';payload=v;return q},insert(v){mode='insert';payload=v;return q},delete(){mode='delete';return q},maybeSingle(){return run(true)},then(a,b){return run(false).then(a,b)}};
    async function run(single){calls.push({table,mode,payload:structuredClone(payload),filters});if(table==='workspace_members')return {data:{role:'member'},error:null};
      if(mode==='insert'&&table==='messages'&&failMessages)return {error:{message:'Offline'}};
      if(mode==='update'&&table==='nodes'&&failSave)return {error:{message:'Offline'}};
      const name=table==='workshop_documents'?'documents':table;let rows=data[name]||[],matches=rows.filter(r=>filters.every(([k,v])=>k==='workspace_id'||r[k]===v));
      if(mode==='insert'){const r={...payload,created_at:new Date().toISOString(),author_label:current};rows.push(r);if(table==='nodes'){r.activity_revision=0;touch(r.id,current)}else touch(r.node_id,current);return {data:null,error:null}}
      if(mode==='update'){matches.forEach(r=>{Object.assign(r,payload);touch(r.id,current)});return {data:matches.map(r=>({id:r.id})),error:null}}
      if(mode==='delete'){data[name]=rows.filter(r=>!matches.includes(r));return {data:matches,error:null}}
      return {data:single?matches[0]||null:structuredClone(matches),error:null};
    }return q;
  }
  const client={from:query,async rpc(name,args){calls.push({rpc:name,args});
    if(name==='workshop_snapshot')return {data:snapshot()};
    if(name==='workshop_mark_read'){reads[current+':'+args.p_node_id]=Math.max(reads[current+':'+args.p_node_id]||0,args.p_revision);return {data:args.p_revision}}
    if(name==='workshop_register_document'){if(failRegistration)return {error:{message:'Metadata failed'}};data.documents.push({id:args.p_id,node_id:args.p_node_id,name:args.p_name,size:args.p_size,mime_type:args.p_mime_type,author_label:current,created_at:new Date().toISOString(),storage_path:window.WORKSPACE_ID+'/'+args.p_node_id+'/'+args.p_id});touch(args.p_node_id,current);return {data:args.p_id}}
    if(name==='workshop_remove_document'){const d=data.documents.find(d=>d.id===args.p_id);data.documents=data.documents.filter(d=>d.id!==args.p_id);if(d)touch(d.node_id,current);return {data:null}}
    return {data:0};
  },channel(){return {on(){return this},subscribe(cb){cb('SUBSCRIBED');return this}}},removeChannel(){},
  storage:{from(){return {async upload(p,f){files.set(p,f);return {data:{path:p}}},async download(p){return files.has(p)?{data:files.get(p)}:{error:{message:'Absent'}}},async remove(paths){paths.forEach(p=>files.delete(p));return {data:[]}}}}}};
  const authListeners=[];
  client.auth={onAuthStateChange(cb){authListeners.push(cb);return {}},async getSession(){return {data:{session:{user:{id:current,email:current+'@example.com'}}}}},async signInWithPassword(){return {data:{user:{id:current,email:current+'@example.com'}}}},async signOut(){authListeners.forEach(cb=>cb('SIGNED_OUT',null));return {error:null}}};
  window.supabase={createClient:()=>client};
  window.__mock={data,calls,files,remote(id,patch){Object.assign(data.nodes.find(n=>n.id===id),patch);touch(id,B)},getSnapshot:snapshot,setFailure(k,v){if(k==='messages')failMessages=v;if(k==='save')failSave=v;if(k==='register')failRegistration=v}};
});
const page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
try{
  await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.node').first().waitFor();
  assert.equal(await page.locator('aside').count(),0);assert.equal(await page.locator('.node').count(),2);
  const budget=page.locator('[data-node-id="n1"]'),comms=page.locator('[data-node-id="n2"]');
  await budget.locator('.open-node').click();await budget.locator('.discussion summary').click();
  await budget.locator('.message-form textarea').fill('<img src=x onerror=alert(1)> budget');await budget.locator('.message-form button').click();
  await page.waitForFunction(()=>document.querySelector('[data-node-id="n1"] .thread').textContent.includes('budget'));
  assert.ok(!(await comms.locator('.thread').textContent()).includes('budget'));assert.equal(await page.locator('.thread img').count(),0);
  assert.match(await budget.locator('.message-meta').textContent(),/alice/);
  // Failed sends keep the draft. Successful retry does not create a duplicate.
  await page.evaluate(()=>__mock.setFailure('messages',true));await budget.locator('.message-form textarea').fill('Brouillon conservé');await budget.locator('.message-form button').click();
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('non envoyé'));
  assert.equal(await budget.locator('.message-form textarea').inputValue(),'Brouillon conservé');
  await page.evaluate(()=>__mock.setFailure('messages',false));await budget.locator('.message-form button').click();await page.waitForFunction(()=>__mock.data.messages.length===2);
  // Refresh while typing keeps both DOM focus and local pending text.
  await page.evaluate(()=>__mock.setFailure('save',true));await budget.locator('.edit-body').fill('Mon brouillon');
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Brouillon conservé'));
  await page.evaluate(()=>{__mock.remote('n1',{body:'Texte distant'});document.getElementById('retry').click()});
  await page.waitForFunction(()=>document.querySelector('[data-node-id="n1"]').classList.contains('unread'));
  assert.equal(await budget.locator('.edit-body').inputValue(),'Mon brouillon');
  await page.evaluate(()=>__mock.setFailure('save',false));await page.locator('#retry').click();await page.waitForFunction(()=>__mock.data.nodes[0].body==='Mon brouillon');
  assert.ok(await budget.evaluate(el=>el.classList.contains('unread')));await budget.locator('.unread-label').click();
  await page.waitForFunction(()=>!document.querySelector('[data-node-id="n1"]').classList.contains('unread'));
  // A new remote update while open remains orange until explicitly acknowledged.
  await page.evaluate(()=>{__mock.remote('n1',{title:'Budget actualisé'});document.getElementById('retry').click()});
  await page.waitForFunction(()=>document.querySelector('[data-node-id="n1"]').classList.contains('unread'));
  await budget.locator('.unread-label').click();await page.waitForFunction(()=>!document.querySelector('[data-node-id="n1"]').classList.contains('unread'));
  // Documents use the current card ID and return to the same card after loading.
  await budget.locator('.discussion summary').click();await budget.locator('.documents summary').click();
  await budget.locator('.file-input').setInputFiles({name:'budget.txt',mimeType:'text/plain',buffer:Buffer.from('123')});
  await page.waitForFunction(()=>document.querySelector('[data-node-id="n1"] .file-list').textContent.includes('budget.txt'));
  assert.ok(!(await comms.locator('.file-list').textContent()).includes('budget.txt'));
  const downloadEvent=page.waitForEvent('download');await budget.locator('.file-actions button').first().click();assert.equal((await downloadEvent).suggestedFilename(),'budget.txt');
  // Metadata failure compensates storage upload and does not leave a phantom document.
  await page.evaluate(()=>__mock.setFailure('register',true));await budget.locator('.file-input').setInputFiles({name:'failed.txt',mimeType:'text/plain',buffer:Buffer.from('x')});
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Envoi interrompu'));assert.equal(await page.evaluate(()=>__mock.files.size),1);
  await page.evaluate(()=>__mock.setFailure('register',false));
  // Expanding/reloading doesn't mix discussions or reset card geometry.
  await budget.locator('.open-node').click();await comms.locator('.open-node').click();await page.locator('#fit').click();
  await page.screenshot({path:path.join(root,'tests','desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.locator('#fit').click();await page.screenshot({path:path.join(root,'tests','mobile.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  assert.deepEqual(errors,[]);console.log('PASS: per-card discussions/files, authors, literal text, pending drafts, unread acknowledgement, upload compensation, desktop/mobile layout.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
