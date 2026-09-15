import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
const sql=await readFile(new URL('../supabase/001_case_collaboration.sql',import.meta.url),'utf8');
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002',C='00000000-0000-4000-8000-000000000003';
const W='10000000-0000-4000-8000-000000000001',W2='10000000-0000-4000-8000-000000000002';
const N='20000000-0000-4000-8000-000000000001',N2='20000000-0000-4000-8000-000000000002';
await db.exec(`
 create role anon; create role authenticated;
 create schema auth; create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create table public.workspace_members(workspace_id uuid,user_id uuid,role text,primary key(workspace_id,user_id));
 create table public.nodes(id uuid primary key,workspace_id uuid not null,x float8,y float8,title text,body text,created_by uuid not null references auth.users,created_at timestamptz default now());
 create table public.messages(id uuid primary key,workspace_id uuid not null,body text,created_by uuid references auth.users,created_at timestamptz default now());
 create table public.links(id uuid primary key,workspace_id uuid not null,source_id uuid references public.nodes on delete cascade,target_id uuid references public.nodes on delete cascade,created_by uuid,created_at timestamptz default now());
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
 alter table storage.objects enable row level security;
 grant usage on schema public,auth,storage to authenticated,anon;
 grant select,insert,update,delete on public.nodes,public.messages,public.links,storage.objects to authenticated;
 grant select on public.workspace_members to authenticated;
 create policy base_nodes on public.nodes for all to authenticated using(true) with check(true);
 create policy base_messages on public.messages for all to authenticated using(true) with check(true);
 create policy base_links on public.links for all to authenticated using(true) with check(true);
 insert into auth.users(id,email) values('${A}','alice@example.com'),('${B}','bob@example.com'),('${C}','outsider@example.com');
 insert into workspace_members values('${W}','${A}','owner'),('${W}','${B}','member'),('${W2}','${C}','owner');
 insert into nodes values('${N}','${W}',0,0,'Sujet A','Notes','${A}',now()),('${N2}','${W2}',0,0,'Autre espace','','${C}',now());
 insert into messages values(gen_random_uuid(),'${W}','Ancien message','${A}',now());
`);
await db.exec(sql);
await db.exec(sql); // Must be safe to rerun.
const q=async(text,args=[]) => (await db.query(text,args)).rows;
async function as(id){await db.exec(`reset role;set test.uid='${id}';set role authenticated;`)}
const snap=async()=> (await q('select workshop_snapshot($1) s',[W]))[0].s;
await as(A);
let s=await snap();assert.equal(s.messages.length,1);assert.equal(s.messages[0].author_label,'alice');assert.ok(s.nodes.some(n=>n.legacy_general&&n.id===s.messages[0].node_id));
assert.ok(!s.nodes.find(n=>n.id===N).unread);
// Bob changes the card. Alice must see orange, even after her own later edit.
await as(B);await q('update nodes set body=$1 where id=$2',['Bob note',N]);
await as(A);s=await snap();assert.ok(s.nodes.find(n=>n.id===N).unread);const seen=s.nodes.find(n=>n.id===N).activity_revision;
await q('update nodes set title=$1 where id=$2',['Alice title',N]);s=await snap();assert.ok(s.nodes.find(n=>n.id===N).unread);
// Acknowledging a displayed revision must not hide an edit made after the snapshot.
await as(B);await q('update nodes set body=$1 where id=$2',['Later note',N]);
await as(A);await q('select workshop_mark_read($1,$2)',[N,seen]);s=await snap();assert.ok(s.nodes.find(n=>n.id===N).unread);
await q('select workshop_mark_read($1,$2)',[N,s.nodes.find(n=>n.id===N).activity_revision]);s=await snap();assert.equal(s.nodes.find(n=>n.id===N).unread,false);
// Persisted read status is user-specific; one's own new edits never create own alerts.
await q('update nodes set title=$1 where id=$2',['Alice only',N]);s=await snap();assert.equal(s.nodes.find(n=>n.id===N).unread,false);
await as(B);s=await snap();assert.ok(s.nodes.find(n=>n.id===N).unread);
// Authorship and cross-workspace integrity are enforced on the server.
await q('insert into messages(id,workspace_id,node_id,body,created_by) values(gen_random_uuid(),$1,$2,$3,$4)',[W,N,'Message B',A]);
s=await snap();assert.equal(s.messages.find(m=>m.body==='Message B').created_by,B);assert.equal(s.messages.find(m=>m.body==='Message B').author_label,'bob');
await assert.rejects(q('insert into messages(id,workspace_id,node_id,body,created_by) values(gen_random_uuid(),$1,$2,$3,$4)',[W,N2,'Bad link',B]));
await assert.rejects(q('update workshop_node_reads set user_id=$1',[B]));
await as(C);await assert.rejects(snap());assert.deepEqual(await q('select * from nodes where id=$1',[N]),[]);
await assert.rejects(q("insert into storage.objects(bucket_id,name) values('workshop-files',$1)",[W+'/'+N+'/test']));
// Private documents, node binding, server labels and safe deletion ordering.
await as(A);const D='30000000-0000-4000-8000-000000000001',path=W+'/'+N+'/'+D;
await q("insert into storage.objects(bucket_id,name) values('workshop-files',$1)",[path]);
await q('select workshop_register_document($1,$2,$3,$4,$5)',[N,D,'budget.pdf',20,'application/pdf']);
s=await snap();assert.equal(s.documents[0].node_id,N);assert.equal(s.documents[0].author_label,'alice');
await assert.rejects(q('delete from nodes where id=$1',[N]));await assert.rejects(q('select workshop_remove_document($1)',[D]));
await as(B);assert.equal((await q('select * from storage.objects where name=$1',[path])).length,1);
await as(C);assert.equal((await q('select * from storage.objects where name=$1',[path])).length,0);
await as(A);await q('delete from storage.objects where name=$1',[path]);await q('select workshop_remove_document($1)',[D]);
assert.equal((await snap()).documents.length,0);
// Old cached UI posts still land in the preserved general discussion.
await q('insert into messages(id,workspace_id,body,created_by) values(gen_random_uuid(),$1,$2,$3)',[W,'Legacy client',A]);s=await snap();assert.ok(s.messages.find(m=>m.body==='Legacy client').node_id);
// Imports are additive and transactional; a bad link rolls back new nodes.
const data={nodes:[{id:'n',x:0,y:0,title:'Imported',body:''}],links:[['n','missing']],messages:[]};
const before=(await snap()).nodes.length;await assert.rejects(q('select workshop_import($1,$2)',[W,data]));assert.equal((await snap()).nodes.length,before);
data.links=[];data.messages=[{node_id:'n',body:'Imported message'}];await q('select workshop_import($1,$2)',[W,data]);s=await snap();assert.equal(s.nodes.length,before+1);assert.ok(s.messages.some(m=>m.body==='Ancien message'));
// Protect the activity counter from direct writes.
const original=s.nodes.find(n=>n.id===N).activity_revision;await q('update nodes set activity_revision=999999 where id=$1',[N]);assert.equal((await snap()).nodes.find(n=>n.id===N).activity_revision,original);
await q('delete from nodes where id=$1',[N]);assert.ok(!(await snap()).messages.some(m=>m.node_id===N));
console.log('PASS: repeatable migration, legacy messages, per-user unread, self edits, racing acknowledgements, RLS, files, atomic import, deletion.');
await db.close();
