-- Run the entire file in the EXISTING project's SQL Editor, before deploying the UI.
-- Additive, transactional and repeatable. No existing table or message is deleted.
begin;

do $$ begin
  if to_regclass('public.nodes') is null or to_regclass('public.messages') is null
     or to_regclass('public.links') is null or to_regclass('public.workspace_members') is null then
    raise exception 'Existing workshop tables are missing. Use the Supabase project already connected to the site.';
  end if;
end $$;

alter table public.nodes add column if not exists activity_revision bigint not null default 0;
alter table public.nodes add column if not exists legacy_general boolean not null default false;
create unique index if not exists workshop_node_workspace_key on public.nodes(id, workspace_id);
create unique index if not exists workshop_general_key on public.nodes(workspace_id) where legacy_general;
alter table public.messages add column if not exists node_id uuid;
alter table public.messages add column if not exists author_label text;

create or replace function public.workshop_is_member(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = auth.uid()
  );
$$;

-- Internal helpers: no direct execution from the browser.
create or replace function public.workshop_author(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select left(coalesce(nullif(u.raw_user_meta_data->>'full_name',''),
    nullif(split_part(u.email,'@',1),''),'Membre'),80) from auth.users u where u.id=p_user),'Ancien membre');
$$;

create or replace function public.workshop_general_node(p_workspace uuid, p_author uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace::text, 0));
  select id into v_id from public.nodes where workspace_id=p_workspace and legacy_general;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into public.nodes(id,workspace_id,x,y,title,body,created_by,legacy_general)
    values(v_id,p_workspace,60,60,'Discussion générale',
      'Messages conservés depuis la discussion commune. Vous pouvez poursuivre les échanges ici.',p_author,true);
  end if;
  return v_id;
end $$;

-- Migrate old messages without changing their IDs, dates, or original authors.
-- Per-workspace grouping, including workspaces that have more than one author.
do $$ declare r record; v_id uuid; v_author uuid;
begin
  for r in select distinct workspace_id from public.messages where node_id is null loop
    select created_by into v_author from public.messages where workspace_id=r.workspace_id order by created_at limit 1;
    v_id := public.workshop_general_node(r.workspace_id,v_author);
    update public.messages set node_id=v_id where workspace_id=r.workspace_id and node_id is null;
  end loop;
end $$;
update public.messages set author_label=public.workshop_author(created_by) where author_label is null;
alter table public.messages alter column node_id set not null;
create index if not exists workshop_messages_node_idx on public.messages(node_id,created_at);
do $$ begin
  if not exists(select 1 from pg_constraint where conname='workshop_messages_node_fk' and conrelid='public.messages'::regclass) then
    alter table public.messages add constraint workshop_messages_node_fk
      foreign key(node_id,workspace_id) references public.nodes(id,workspace_id) on delete cascade;
  end if;
end $$;

create table if not exists public.workshop_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  node_id uuid not null,
  name text not null check(length(name) between 1 and 500),
  size bigint not null check(size between 0 and 20971520),
  mime_type text not null default 'application/octet-stream',
  storage_path text not null unique,
  created_by uuid not null,
  author_label text not null default '',
  created_at timestamptz not null default now(),
  foreign key(node_id,workspace_id) references public.nodes(id,workspace_id) on delete restrict
);
create index if not exists workshop_documents_node_idx on public.workshop_documents(node_id,created_at);
create table if not exists public.workshop_node_activity (
  node_id uuid not null references public.nodes(id) on delete cascade,
  actor_id uuid not null,
  revision bigint not null,
  primary key(node_id,actor_id)
);
create table if not exists public.workshop_node_reads (
  node_id uuid not null references public.nodes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seen_revision bigint not null default 0,
  primary key(node_id,user_id)
);

-- Revisions are assigned under the node row lock, not using the client's clock.
-- One last revision PER ACTOR: a later own edit cannot conceal another person's edit.
create or replace function public.workshop_touch(p_node uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_revision bigint; v_actor uuid := auth.uid();
begin
  if v_actor is null then return; end if;
  update public.nodes set activity_revision=activity_revision+1 where id=p_node returning activity_revision into v_revision;
  if found then
    insert into public.workshop_node_activity(node_id,actor_id,revision) values(p_node,v_actor,v_revision)
    on conflict(node_id,actor_id) do update set revision=excluded.revision;
  end if;
end $$;

create or replace function public.workshop_node_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='DELETE' then
    if exists(select 1 from public.workshop_documents where node_id=old.id)
       or exists(select 1 from storage.objects where bucket_id='workshop-files'
          and name like old.workspace_id::text || '/' || old.id::text || '/%') then
      raise exception 'Retirez les documents de cette case avant de la supprimer.';
    end if;
    return old;
  end if;
  if tg_op='UPDATE' then
    if new.id<>old.id or new.workspace_id<>old.workspace_id then raise exception 'Case non déplaçable entre espaces.'; end if;
    if auth.uid() is not null and pg_trigger_depth()=1 then
      new.activity_revision := old.activity_revision;
      new.legacy_general := old.legacy_general;
      new.created_by := old.created_by;
    end if;
  elsif auth.uid() is not null then
    new.created_by := auth.uid();
    new.activity_revision := 0;
  end if;
  return new;
end $$;
drop trigger if exists workshop_node_guard on public.nodes;
create trigger workshop_node_guard before insert or update or delete on public.nodes
  for each row execute function public.workshop_node_guard();

create or replace function public.workshop_track_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_node uuid;
begin
  if tg_table_name='nodes' then
    if tg_op='INSERT' or (new.title,new.body,new.x,new.y) is distinct from (old.title,old.body,old.x,old.y) then
      perform public.workshop_touch(new.id);
    end if;
  elsif tg_table_name='links' then
    if tg_op='DELETE' then
      for v_node in select distinct v from unnest(array[old.source_id,old.target_id]) v order by v loop
        perform public.workshop_touch(v_node);
      end loop;
    else
      for v_node in select distinct v from unnest(array[new.source_id,new.target_id]) v order by v loop
        perform public.workshop_touch(v_node);
      end loop;
    end if;
  else
    if tg_op='DELETE' then perform public.workshop_touch(old.node_id);
    else perform public.workshop_touch(new.node_id); end if;
  end if;
  return null;
end $$;
drop trigger if exists workshop_node_activity on public.nodes;
create trigger workshop_node_activity after insert or update on public.nodes for each row execute function public.workshop_track_activity();
drop trigger if exists workshop_message_activity on public.messages;
create trigger workshop_message_activity after insert or update or delete on public.messages for each row execute function public.workshop_track_activity();
drop trigger if exists workshop_document_activity on public.workshop_documents;
create trigger workshop_document_activity after insert or delete on public.workshop_documents for each row execute function public.workshop_track_activity();
drop trigger if exists workshop_link_activity on public.links;
create trigger workshop_link_activity after insert or delete on public.links for each row execute function public.workshop_track_activity();

create or replace function public.workshop_message_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' then
    if (new.id,new.workspace_id,new.node_id,new.created_by) is distinct from (old.id,old.workspace_id,old.node_id,old.created_by) then
      raise exception 'Un message ne peut pas changer de case ou d’auteur.';
    end if;
    new.author_label:=old.author_label;
  else
    if auth.uid() is not null then new.created_by:=auth.uid(); end if;
    new.author_label:=public.workshop_author(new.created_by);
    -- Old cached clients can continue posting to the general discussion.
    if new.node_id is null then
      if not public.workshop_is_member(new.workspace_id) then raise exception 'Accès refusé'; end if;
      new.node_id:=public.workshop_general_node(new.workspace_id,new.created_by);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists workshop_message_guard on public.messages;
create trigger workshop_message_guard before insert or update on public.messages for each row execute function public.workshop_message_guard();

-- Existing policies stay in place. Restrictive policies also enforce workspace isolation.
alter table public.nodes enable row level security;
alter table public.messages enable row level security;
alter table public.links enable row level security;
drop policy if exists workshop_nodes_boundary on public.nodes;
create policy workshop_nodes_boundary on public.nodes as restrictive for all to public
  using(public.workshop_is_member(workspace_id)) with check(public.workshop_is_member(workspace_id));
drop policy if exists workshop_messages_boundary on public.messages;
create policy workshop_messages_boundary on public.messages as restrictive for all to public
  using(public.workshop_is_member(workspace_id)) with check(public.workshop_is_member(workspace_id));
drop policy if exists workshop_links_boundary on public.links;
create policy workshop_links_boundary on public.links as restrictive for all to public
  using(public.workshop_is_member(workspace_id)) with check(public.workshop_is_member(workspace_id)
    and exists(select 1 from public.nodes where id=source_id and nodes.workspace_id=links.workspace_id)
    and exists(select 1 from public.nodes where id=target_id and nodes.workspace_id=links.workspace_id));

alter table public.workshop_documents enable row level security;
alter table public.workshop_node_activity enable row level security;
alter table public.workshop_node_reads enable row level security;
revoke all on public.workshop_documents, public.workshop_node_activity, public.workshop_node_reads from anon, authenticated;
grant select on public.workshop_documents, public.workshop_node_activity, public.workshop_node_reads to authenticated;
drop policy if exists workshop_documents_read on public.workshop_documents;
create policy workshop_documents_read on public.workshop_documents for select to authenticated using(public.workshop_is_member(workspace_id));
drop policy if exists workshop_activity_read on public.workshop_node_activity;
create policy workshop_activity_read on public.workshop_node_activity for select to authenticated
  using(exists(select 1 from public.nodes n where n.id=node_id and public.workshop_is_member(n.workspace_id)));
drop policy if exists workshop_reads_read on public.workshop_node_reads;
create policy workshop_reads_read on public.workshop_node_reads for select to authenticated using(user_id=auth.uid());

insert into storage.buckets(id,name,public,file_size_limit)
values('workshop-files','workshop-files',false,20971520)
on conflict(id) do update set public=false,file_size_limit=20971520;

create or replace function public.workshop_can_access_file(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.nodes n
    where n.workspace_id::text=split_part(p_path,'/',1) and n.id::text=split_part(p_path,'/',2)
    and array_length(string_to_array(p_path,'/'),1)=3
    and public.workshop_is_member(n.workspace_id));
$$;
drop policy if exists workshop_files_read on storage.objects;
create policy workshop_files_read on storage.objects for select to authenticated
  using(bucket_id='workshop-files' and public.workshop_can_access_file(name));
drop policy if exists workshop_files_insert on storage.objects;
create policy workshop_files_insert on storage.objects for insert to authenticated
  with check(bucket_id='workshop-files' and public.workshop_can_access_file(name));
drop policy if exists workshop_files_delete on storage.objects;
create policy workshop_files_delete on storage.objects for delete to authenticated
  using(bucket_id='workshop-files' and public.workshop_can_access_file(name));
-- Existing broad storage policies cannot open this private bucket to non-members.
drop policy if exists workshop_files_boundary on storage.objects;
create policy workshop_files_boundary on storage.objects as restrictive for all to public
  using(bucket_id<>'workshop-files' or public.workshop_can_access_file(name))
  with check(bucket_id<>'workshop-files' or public.workshop_can_access_file(name));
drop policy if exists workshop_files_no_overwrite on storage.objects;
create policy workshop_files_no_overwrite on storage.objects as restrictive for update to public
  using(bucket_id<>'workshop-files') with check(bucket_id<>'workshop-files');

create or replace function public.workshop_register_document(p_node_id uuid,p_id uuid,p_name text,p_size bigint,p_mime_type text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_workspace uuid; v_path text;
begin
  select workspace_id into v_workspace from public.nodes where id=p_node_id for update;
  if v_workspace is null or not public.workshop_is_member(v_workspace) then raise exception 'Accès refusé'; end if;
  v_path:=v_workspace::text || '/' || p_node_id::text || '/' || p_id::text;
  if not exists(select 1 from storage.objects where bucket_id='workshop-files' and name=v_path) then
    raise exception 'Fichier non téléversé';
  end if;
  insert into public.workshop_documents(id,workspace_id,node_id,name,size,mime_type,storage_path,created_by,author_label)
  values(p_id,v_workspace,p_node_id,p_name,p_size,coalesce(p_mime_type,'application/octet-stream'),v_path,auth.uid(),public.workshop_author(auth.uid()));
  return p_id;
end $$;

create or replace function public.workshop_remove_document(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_doc public.workshop_documents;
begin
  select * into v_doc from public.workshop_documents where id=p_id for update;
  if not found then return; end if;
  if not public.workshop_is_member(v_doc.workspace_id) then raise exception 'Accès refusé'; end if;
  if exists(select 1 from storage.objects where bucket_id='workshop-files' and name=v_doc.storage_path) then
    raise exception 'Supprimez le fichier du stockage avant sa référence';
  end if;
  delete from public.workshop_documents where id=p_id;
end $$;

-- A single SQL statement produces a consistent snapshot including read watermarks.
create or replace function public.workshop_snapshot(p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not public.workshop_is_member(p_workspace_id) then raise exception 'Accès refusé'; end if;
  select jsonb_build_object('version',2,
    'nodes',coalesce((select jsonb_agg(to_jsonb(n)||jsonb_build_object('unread',exists(
       select 1 from public.workshop_node_activity a where a.node_id=n.id and a.actor_id<>auth.uid()
       and a.revision>coalesce((select seen_revision from public.workshop_node_reads r where r.node_id=n.id and r.user_id=auth.uid()),0)))
       order by n.created_at,n.id) from public.nodes n where n.workspace_id=p_workspace_id),'[]'::jsonb),
    'links',coalesce((select jsonb_agg(l order by l.created_at,l.id) from public.links l where l.workspace_id=p_workspace_id),'[]'::jsonb),
    'messages',coalesce((select jsonb_agg(m order by m.created_at,m.id) from public.messages m where m.workspace_id=p_workspace_id),'[]'::jsonb),
    'documents',coalesce((select jsonb_agg(d order by d.created_at,d.id) from public.workshop_documents d where d.workspace_id=p_workspace_id),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

create or replace function public.workshop_mark_read(p_node_id uuid,p_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_node public.nodes; v_seen bigint;
begin
  select * into v_node from public.nodes where id=p_node_id;
  if not found or not public.workshop_is_member(v_node.workspace_id) then raise exception 'Accès refusé'; end if;
  -- Never acknowledge edits newer than the exact snapshot the user opened.
  v_seen:=greatest(0,least(coalesce(p_revision,0),v_node.activity_revision));
  insert into public.workshop_node_reads(node_id,user_id,seen_revision) values(p_node_id,auth.uid(),v_seen)
  on conflict(node_id,user_id) do update set seen_revision=greatest(workshop_node_reads.seen_revision,excluded.seen_revision)
  returning seen_revision into v_seen;
  return v_seen;
end $$;

-- Imports add cases atomically. They never erase existing discussions or documents.
create or replace function public.workshop_import(p_workspace_id uuid,p_data jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_new uuid; v_map jsonb:='{}'; v_general uuid; v_count integer:=0; v_workspace uuid;
begin
  if not public.workshop_is_member(p_workspace_id) then raise exception 'Accès refusé'; end if;
  if jsonb_typeof(p_data->'nodes') is distinct from 'array' or jsonb_typeof(p_data->'links') is distinct from 'array'
     or jsonb_typeof(p_data->'messages') is distinct from 'array' then raise exception 'Format invalide'; end if;
  if jsonb_array_length(p_data->'nodes')>1000 or jsonb_array_length(p_data->'messages')>10000
     or jsonb_array_length(p_data->'links')>10000 then raise exception 'Import trop volumineux'; end if;
  for r in select value from jsonb_array_elements(p_data->'nodes') loop
    if jsonb_typeof(r->'id') is distinct from 'string' or jsonb_typeof(r->'title') is distinct from 'string'
       or jsonb_typeof(r->'body') is distinct from 'string' or jsonb_typeof(r->'x') is distinct from 'number'
       or jsonb_typeof(r->'y') is distinct from 'number' or v_map ? (r->>'id') then raise exception 'Case invalide ou identifiant en double'; end if;
    v_new:=gen_random_uuid();v_map:=v_map||jsonb_build_object(r->>'id',v_new);
    insert into public.nodes(id,workspace_id,x,y,title,body,created_by)
      values(v_new,p_workspace_id,(r->>'x')::double precision,(r->>'y')::double precision,r->>'title',r->>'body',auth.uid());
    v_count:=v_count+1;
  end loop;
  for r in select value from jsonb_array_elements(p_data->'links') loop
    if jsonb_typeof(r) is distinct from 'array' or jsonb_array_length(r)<>2
       or not(v_map ? (r->>0)) or not(v_map ? (r->>1)) then raise exception 'Lien invalide'; end if;
    insert into public.links(id,workspace_id,source_id,target_id,created_by)
      values(gen_random_uuid(),p_workspace_id,(v_map->>(r->>0))::uuid,(v_map->>(r->>1))::uuid,auth.uid());
  end loop;
  for r in select value from jsonb_array_elements(p_data->'messages') loop
    if jsonb_typeof(r)='string' then
      if v_general is null then v_general:=public.workshop_general_node(p_workspace_id,auth.uid()); end if;
      insert into public.messages(id,workspace_id,node_id,body,created_by)
        values(gen_random_uuid(),p_workspace_id,v_general,r#>>'{}',auth.uid());
    else
      if jsonb_typeof(r->'body') is distinct from 'string' or not(v_map ? (r->>'node_id')) then raise exception 'Message invalide'; end if;
      insert into public.messages(id,workspace_id,node_id,body,created_by)
        values(gen_random_uuid(),p_workspace_id,(v_map->>(r->>'node_id'))::uuid,r->>'body',auth.uid());
    end if;
  end loop;
  return v_count;
end $$;

-- Remove implicit PUBLIC execution, including internal trigger helpers.
do $$ declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'workshop\_%' escape '\' loop
    execute format('revoke all on function %s from public, anon, authenticated',r.sig);
  end loop;
end $$;
grant execute on function public.workshop_is_member(uuid),public.workshop_can_access_file(text) to anon,authenticated;
grant execute on function public.workshop_snapshot(uuid),public.workshop_mark_read(uuid,bigint),
  public.workshop_register_document(uuid,uuid,text,bigint,text),public.workshop_remove_document(uuid),
  public.workshop_import(uuid,jsonb) to authenticated;

-- Existing node/message changes wake the client; periodic refresh covers missed events.
do $$ declare t text;
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime' and not puballtables) then
    foreach t in array array['nodes','links','messages','workshop_documents','workshop_node_reads'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
        execute format('alter publication supabase_realtime add table public.%I',t);
      end if;
    end loop;
  end if;
end $$;
notify pgrst,'reload schema';
commit;
