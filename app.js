'use strict';

const $ = id => document.getElementById(id);
const uid = () => globalThis.crypto?.randomUUID?.()
  || Date.now().toString(36) + Math.random().toString(36).slice(2);

const WORKSPACE_ID = window.WORKSPACE_ID;
const sb = window.sbClient;

let currentUser = null;
let state = {
  nodes: [],
  links: [],
  messages: []
};

let scale = 1;
let px = 0;
let py = 0;
let source = null;
let realtimeChannel = null;
let started = false;

const updateTimers = new Map();

function status(text) {
  $('status').textContent = text;
}

function transform() {
  $('world').style.transform =
    'translate(' + px + 'px,' + py + 'px) scale(' + scale + ')';
}

function validImport(s) {
  return s &&
    Array.isArray(s.nodes) &&
    s.nodes.length <= 1000 &&
    s.nodes.every(n =>
      Number.isFinite(n.x) &&
      Number.isFinite(n.y) &&
      typeof n.title === 'string' &&
      typeof n.body === 'string'
    ) &&
    Array.isArray(s.links) &&
    Array.isArray(s.messages);
}

/* =========================================================
   SUPABASE
   ========================================================= */

async function loadSharedState() {
  status('Chargement du tableau partagé…');

  const [nodesResult, linksResult, messagesResult] = await Promise.all([
    sb
      .from('nodes')
      .select('*')
      .eq('workspace_id', WORKSPACE_ID)
      .order('created_at'),

    sb
      .from('links')
      .select('*')
      .eq('workspace_id', WORKSPACE_ID)
      .order('created_at'),

    sb
      .from('messages')
      .select('*')
      .eq('workspace_id', WORKSPACE_ID)
      .order('created_at')
  ]);

  if (nodesResult.error) throw nodesResult.error;
  if (linksResult.error) throw linksResult.error;
  if (messagesResult.error) throw messagesResult.error;

  state.nodes = nodesResult.data || [];
  state.links = linksResult.data || [];
  state.messages = messagesResult.data || [];

  render();
  transform();

  if (state.nodes.length) {
    $('fit').click();
  }

  status('Tableau partagé chargé.');
}

async function updateNode(node) {
  const { error } = await sb
    .from('nodes')
    .update({
      x: node.x,
      y: node.y,
      title: node.title,
      body: node.body
    })
    .eq('id', node.id)
    .eq('workspace_id', WORKSPACE_ID);

  if (error) {
    console.error(error);
    status('Erreur pendant la sauvegarde de la case.');
    return;
  }

  status('Modifications sauvegardées dans l’espace partagé.');
}

function scheduleNodeUpdate(node) {
  clearTimeout(updateTimers.get(node.id));

  updateTimers.set(
    node.id,
    setTimeout(() => {
      updateTimers.delete(node.id);
      updateNode(node);
    }, 500)
  );
}

/* =========================================================
   LIENS
   ========================================================= */

function draw() {
  $('lines').replaceChildren();

  state.links.forEach(link => {
    const a = state.nodes.find(n => n.id === link.source_id);
    const b = state.nodes.find(n => n.id === link.target_id);

    if (!a || !b) return;

    const p = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'path'
    );

    p.setAttribute(
      'd',
      'M ' + (a.x + 150) + ' ' + (a.y + 110) +
      ' L ' + (b.x + 150) + ' ' + (b.y + 110)
    );

    p.setAttribute('stroke', '#82cbb9');
    p.setAttribute('stroke-width', '10');
    p.setAttribute('fill', 'none');

    p.style.cursor = 'pointer';
    p.style.pointerEvents = 'stroke';

    p.onpointerdown = e => e.stopPropagation();

    p.onclick = async () => {
      const { error } = await sb
        .from('links')
        .delete()
        .eq('id', link.id);

      if (error) {
        status('Impossible de supprimer le lien.');
        return;
      }

      state.links = state.links.filter(v => v.id !== link.id);
      draw();
      status('Lien supprimé du tableau partagé.');
    };

    $('lines').append(p);
  });
}

/* =========================================================
   CASES
   ========================================================= */

function render() {
  $('nodes').replaceChildren();

  for (const n of state.nodes) {
    const el = document.createElement('article');

    el.className = 'node';
    el.dataset.nodeId = n.id;
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';

    el.innerHTML =
      '<div class="row">' +
      '<button class="handle" aria-label="Déplacer">☰</button>' +
      '<input aria-label="Titre">' +
      '<button class="del" aria-label="Supprimer">×</button>' +
      '</div>' +
      '<textarea aria-label="Contenu"></textarea>' +
      '<button class="link">Relier cette case</button>';

    const title = el.querySelector('input');
    const body = el.querySelector('textarea');

    title.value = n.title;
    body.value = n.body;

    title.oninput = e => {
      n.title = e.target.value;
      scheduleNodeUpdate(n);
    };

    body.oninput = e => {
      n.body = e.target.value;
      scheduleNodeUpdate(n);
    };

    el.querySelector('.del').onclick = async () => {
      if (!confirm('Supprimer cette case du tableau partagé ?')) return;

      const { error } = await sb
        .from('nodes')
        .delete()
        .eq('id', n.id);

      if (error) {
        status('Impossible de supprimer la case.');
        return;
      }

      state.nodes = state.nodes.filter(v => v.id !== n.id);

      state.links = state.links.filter(
        l => l.source_id !== n.id && l.target_id !== n.id
      );

      if (source === n.id) source = null;

      render();
      status('Case supprimée.');
    };

    if (source === n.id) {
      el.classList.add('selected');
    }

    el.querySelector('.link').onclick = async () => {
      if (!source) {
        source = n.id;
        el.classList.add('selected');

        status(
          'Cliquez sur Relier dans la case de destination, ' +
          'ou à nouveau ici pour annuler.'
        );

        return;
      }

      if (source === n.id) {
        source = null;
        render();
        status('Création du lien annulée.');
        return;
      }

      const exists = state.links.some(l =>
        (l.source_id === source && l.target_id === n.id) ||
        (l.source_id === n.id && l.target_id === source)
      );

      if (!exists) {
        const newLink = {
          id: uid(),
          workspace_id: WORKSPACE_ID,
          source_id: source,
          target_id: n.id,
          created_by: currentUser.id
        };

        const { error } = await sb
          .from('links')
          .insert(newLink);

        if (error) {
          console.error(error);
          status('Impossible de créer le lien.');
        } else {
          state.links.push(newLink);
        }
      }

      source = null;
      render();
    };

    const handle = el.querySelector('.handle');
    let drag = null;

    handle.onpointerdown = e => {
      e.preventDefault();
      e.stopPropagation();

      handle.setPointerCapture(e.pointerId);

      drag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY
      };
    };

    handle.onpointermove = e => {
      if (!drag || drag.id !== e.pointerId) return;

      n.x += (e.clientX - drag.x) / scale;
      n.y += (e.clientY - drag.y) / scale;

      drag.x = e.clientX;
      drag.y = e.clientY;

      el.style.left = n.x + 'px';
      el.style.top = n.y + 'px';

      draw();
    };

    handle.onpointerup = handle.onpointercancel = async () => {
      if (!drag) return;

      drag = null;
      await updateNode(n);
    };

    $('nodes').append(el);
  }

  draw();
  renderMessages();
}

/* =========================================================
   MESSAGES
   ========================================================= */

function renderMessages() {
  $('messages').replaceChildren();

  for (const message of state.messages) {
    const p = document.createElement('p');
    p.textContent = message.body;
    $('messages').append(p);
  }

  $('messages').scrollTop = $('messages').scrollHeight;
}

$('chat').onsubmit = async e => {
  e.preventDefault();

  const text = $('message').value.trim();

  if (!text || !currentUser) return;

  const message = {
    id: uid(),
    workspace_id: WORKSPACE_ID,
    body: text,
    created_by: currentUser.id,
    created_at: new Date().toISOString()
  };

  const { error } = await sb
    .from('messages')
    .insert({
      id: message.id,
      workspace_id: message.workspace_id,
      body: message.body,
      created_by: message.created_by
    });

  if (error) {
    status('Impossible d’envoyer le message.');
    return;
  }

  state.messages.push(message);
  $('message').value = '';

  renderMessages();
};

/* =========================================================
   NAVIGATION / ZOOM
   ========================================================= */

const pointers = new Map();
let prev = null;

function gesture() {
  const p = [...pointers.values()];

  return p.length === 1
    ? { x: p[0].x, y: p[0].y, d: 0 }
    : {
        x: (p[0].x + p[1].x) / 2,
        y: (p[0].y + p[1].y) / 2,
        d: Math.hypot(
          p[0].x - p[1].x,
          p[0].y - p[1].y
        )
      };
}

$('view').onpointerdown = e => {
  if (e.target.closest('.node')) return;

  pointers.set(
    e.pointerId,
    { x: e.clientX, y: e.clientY }
  );

  $('view').setPointerCapture(e.pointerId);
  prev = gesture();
};

$('view').onpointermove = e => {
  if (!pointers.has(e.pointerId)) return;

  pointers.set(
    e.pointerId,
    { x: e.clientX, y: e.clientY }
  );

  const g = gesture();

  if (prev) {
    px += g.x - prev.x;
    py += g.y - prev.y;

    if (g.d && prev.d) {
      zoom(
        scale * g.d / prev.d,
        g.x,
        g.y
      );
    }

    transform();
  }

  prev = g;
};

function end(e) {
  pointers.delete(e.pointerId);
  prev = pointers.size ? gesture() : null;
}

$('view').onpointerup = end;
$('view').onpointercancel = end;

function zoom(s, x, y) {
  s = Math.max(.15, Math.min(3, s));

  const r = $('view').getBoundingClientRect();
  const a = x - r.left;
  const b = y - r.top;

  px = a - (a - px) * s / scale;
  py = b - (b - py) * s / scale;

  scale = s;

  transform();
}

$('view').addEventListener(
  'wheel',
  e => {
    if (e.target.closest('textarea')) return;

    e.preventDefault();

    zoom(
      scale * Math.exp(-e.deltaY * .0015),
      e.clientX,
      e.clientY
    );
  },
  { passive: false }
);

function step(f) {
  const r = $('view').getBoundingClientRect();

  zoom(
    scale * f,
    r.left + r.width / 2,
    r.top + r.height / 2
  );
}

$('plus').onclick = () => step(1.2);
$('minus').onclick = () => step(1 / 1.2);

$('fit').onclick = () => {
  if (!state.nodes.length) return;

  const x = Math.min(...state.nodes.map(n => n.x));
  const y = Math.min(...state.nodes.map(n => n.y));

  const w =
    Math.max(...state.nodes.map(n => n.x + 300)) - x;

  const h =
    Math.max(...state.nodes.map(n => n.y + 320)) - y;

  scale = Math.max(
    .15,
    Math.min(
      1,
      ($('view').clientWidth - 40) / w,
      ($('view').clientHeight - 40) / h
    )
  );

  px =
    ($('view').clientWidth - w * scale) / 2 -
    x * scale;

  py =
    ($('view').clientHeight - h * scale) / 2 -
    y * scale;

  transform();
};

/* =========================================================
   AJOUT D'UNE CASE
   ========================================================= */

$('add').onclick = async () => {
  if (!currentUser) return;

  const node = {
    id: uid(),
    workspace_id: WORKSPACE_ID,

    x:
      ($('view').clientWidth / 2 - px) /
        scale -
      150,

    y:
      ($('view').clientHeight / 2 - py) /
        scale -
      100,

    title: 'Nouvelle case',

    body:
      'Notes :\n\n' +
      'Formules / valeurs :\n\n' +
      'Décisions :',

    created_by: currentUser.id,
    created_at: new Date().toISOString()
  };

  const { error } = await sb
    .from('nodes')
    .insert({
      id: node.id,
      workspace_id: node.workspace_id,
      x: node.x,
      y: node.y,
      title: node.title,
      body: node.body,
      created_by: node.created_by
    });

  if (error) {
    console.error(error);
    status('Impossible d’ajouter la case.');
    return;
  }

  state.nodes.push(node);

  render();
  status('Case ajoutée au tableau partagé.');
};

/* =========================================================
   EXPORT / IMPORT
   ========================================================= */

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = name;

  document.body.append(a);
  a.click();
  a.remove();

  setTimeout(
    () => URL.revokeObjectURL(url),
    60000
  );
}

$('export').onclick = () => {
  const exported = {
    nodes: state.nodes.map(n => ({
      id: n.id,
      x: n.x,
      y: n.y,
      title: n.title,
      body: n.body
    })),

    links: state.links.map(l => [
      l.source_id,
      l.target_id
    ]),

    messages: state.messages.map(m => m.body)
  };

  download(
    new Blob(
      [JSON.stringify(exported, null, 2)],
      { type: 'application/json' }
    ),
    'workshop.json'
  );
};

$('importButton').onclick = () =>
  $('import').click();

$('import').onchange = async e => {
  try {
    const file = e.target.files[0];

    if (!file) return;

    const imported =
      JSON.parse(await file.text());

    if (!validImport(imported)) {
      throw new Error('Format invalide');
    }

    if (!confirm(
      'Remplacer le tableau partagé actuel pour les 3 utilisateurs ?'
    )) {
      return;
    }

    status('Import vers le tableau partagé…');

    const { error: messagesDeleteError } =
      await sb
        .from('messages')
        .delete()
        .eq('workspace_id', WORKSPACE_ID);

    if (messagesDeleteError) {
      throw messagesDeleteError;
    }

    const { error: nodesDeleteError } =
      await sb
        .from('nodes')
        .delete()
        .eq('workspace_id', WORKSPACE_ID);

    if (nodesDeleteError) {
      throw nodesDeleteError;
    }

    const idMap = new Map();

    const newNodes = imported.nodes.map(n => {
      const newId = uid();

      idMap.set(n.id, newId);

      return {
        id: newId,
        workspace_id: WORKSPACE_ID,
        x: n.x,
        y: n.y,
        title: n.title,
        body: n.body,
        created_by: currentUser.id
      };
    });

    if (newNodes.length) {
      const { error } = await sb
        .from('nodes')
        .insert(newNodes);

      if (error) throw error;
    }

    const newLinks = imported.links
      .filter(l =>
        Array.isArray(l) &&
        l.length === 2 &&
        idMap.has(l[0]) &&
        idMap.has(l[1])
      )
      .map(l => ({
        id: uid(),
        workspace_id: WORKSPACE_ID,
        source_id: idMap.get(l[0]),
        target_id: idMap.get(l[1]),
        created_by: currentUser.id
      }));

    if (newLinks.length) {
      const { error } = await sb
        .from('links')
        .insert(newLinks);

      if (error) throw error;
    }

    const newMessages = imported.messages
      .filter(m => typeof m === 'string')
      .map(m => ({
        id: uid(),
        workspace_id: WORKSPACE_ID,
        body: m,
        created_by: currentUser.id
      }));

    if (newMessages.length) {
      const { error } = await sb
        .from('messages')
        .insert(newMessages);

      if (error) throw error;
    }

    source = null;

    await loadSharedState();

    status('Tableau importé dans l’espace partagé.');
  } catch (error) {
    console.error(error);
    status('Import impossible : fichier ou données invalides.');
  } finally {
    e.target.value = '';
  }
};

/* =========================================================
   REALTIME
   ========================================================= */

function applyRemoteNode(payload) {
  const row = payload.new;
  const old = payload.old;

  if (payload.eventType === 'INSERT') {
    if (!state.nodes.some(n => n.id === row.id)) {
      state.nodes.push(row);
      render();
    }

    return;
  }

  if (payload.eventType === 'UPDATE') {
    const node =
      state.nodes.find(n => n.id === row.id);

    if (!node) {
      state.nodes.push(row);
      render();
      return;
    }

    Object.assign(node, row);

    const el =
      document.querySelector(
        '[data-node-id="' + row.id + '"]'
      );

    if (el) {
      el.style.left = row.x + 'px';
      el.style.top = row.y + 'px';

      const input =
        el.querySelector('input');

      const textarea =
        el.querySelector('textarea');

      if (document.activeElement !== input) {
        input.value = row.title;
      }

      if (document.activeElement !== textarea) {
        textarea.value = row.body;
      }

      draw();
    }

    return;
  }

  if (payload.eventType === 'DELETE') {
    state.nodes =
      state.nodes.filter(n => n.id !== old.id);

    state.links =
      state.links.filter(l =>
        l.source_id !== old.id &&
        l.target_id !== old.id
      );

    render();
  }
}

function applyRemoteLink(payload) {
  const row = payload.new;
  const old = payload.old;

  if (payload.eventType === 'INSERT') {
    if (!state.links.some(l => l.id === row.id)) {
      state.links.push(row);
      draw();
    }

    return;
  }

  if (payload.eventType === 'DELETE') {
    state.links =
      state.links.filter(l => l.id !== old.id);

    draw();
  }
}

function applyRemoteMessage(payload) {
  const row = payload.new;
  const old = payload.old;

  if (payload.eventType === 'INSERT') {
    if (!state.messages.some(m => m.id === row.id)) {
      state.messages.push(row);

      state.messages.sort(
        (a, b) =>
          new Date(a.created_at) -
          new Date(b.created_at)
      );

      renderMessages();
    }

    return;
  }

  if (payload.eventType === 'DELETE') {
    state.messages =
      state.messages.filter(
        m => m.id !== old.id
      );

    renderMessages();
  }
}

function subscribeRealtime() {
  if (realtimeChannel) {
    sb.removeChannel(realtimeChannel);
  }

  realtimeChannel =
    sb
      .channel(
        'workshop-' + WORKSPACE_ID
      )

      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'nodes',
          filter:
            'workspace_id=eq.' +
            WORKSPACE_ID
        },
        applyRemoteNode
      )

      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'links',
          filter:
            'workspace_id=eq.' +
            WORKSPACE_ID
        },
        applyRemoteLink
      )

      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter:
            'workspace_id=eq.' +
            WORKSPACE_ID
        },
        applyRemoteMessage
      )

      .subscribe();
}

/* =========================================================
   DOCUMENTS
   Encore locaux pour l'instant
   ========================================================= */

let db;

try {
  const req =
    indexedDB.open(
      'workshop-documents',
      1
    );

  req.onupgradeneeded = () =>
    req.result.createObjectStore(
      'files',
      { keyPath: 'id' }
    );

  req.onsuccess = () => {
    db = req.result;
    listFiles();
  };

  req.onerror = () =>
    status(
      'Stockage local des documents indisponible.'
    );
} catch {
  status(
    'Stockage local des documents indisponible.'
  );
}

function listFiles() {
  if (!db) return;

  const request =
    db
      .transaction('files')
      .objectStore('files')
      .getAll();

  request.onsuccess = () => {
    $('files').replaceChildren();

    for (const item of request.result) {
      const p =
        document.createElement('p');

      const button =
        document.createElement('button');

      const remove =
        document.createElement('button');

      button.textContent =
        item.file.name;

      button.onclick = () =>
        download(
          item.file,
          item.file.name
        );

      remove.textContent = '×';

      remove.setAttribute(
        'aria-label',
        'Supprimer ' + item.file.name
      );

      remove.onclick = () => {
        const t =
          db.transaction(
            'files',
            'readwrite'
          );

        t.objectStore('files')
          .delete(item.id);

        t.oncomplete =
          listFiles;
      };

      p.append(
        button,
        remove
      );

      $('files').append(p);
    }
  };
}

function addFiles(files) {
  if (!db) {
    status(
      'Stockage local des fichiers indisponible.'
    );
    return;
  }

  const t =
    db.transaction(
      'files',
      'readwrite'
    );

  for (const file of files) {
    t.objectStore('files')
      .put({
        id: uid(),
        file
      });
  }

  t.oncomplete = () => {
    listFiles();

    status(
      'Documents sauvegardés localement sur cet appareil.'
    );
  };

  t.onerror = () =>
    status(
      'Échec de sauvegarde des documents.'
    );
}

$('upload').onchange = e => {
  addFiles(e.target.files);
  e.target.value = '';
};

$('drop').ondragover =
  e => e.preventDefault();

$('drop').ondrop = e => {
  e.preventDefault();
  addFiles(e.dataTransfer.files);
};

/* =========================================================
   DEMARRAGE
   ========================================================= */

async function startSharedWorkshop(user) {
  if (started) return;

  started = true;
  currentUser = user;

  try {
    await loadSharedState();
    subscribeRealtime();
  } catch (error) {
    console.error(error);

    started = false;

    status(
      'Impossible de charger le tableau partagé.'
    );
  }
}

async function initializeWorkshop() {
  const {
    data: { session }
  } = await sb.auth.getSession();

  if (session?.user) {
    startSharedWorkshop(
      session.user
    );
  }
}

sb.auth.onAuthStateChange(
  (event, session) => {
    if (
  (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') &&
  session?.user
) {
      startSharedWorkshop(
        session.user
      );
    }

    if (event === 'SIGNED_OUT') {
      currentUser = null;
      started = false;

      if (realtimeChannel) {
        sb.removeChannel(
          realtimeChannel
        );

        realtimeChannel = null;
      }

      state = {
        nodes: [],
        links: [],
        messages: []
      };

      render();
    }
  }
);

render();
transform();
initializeWorkshop();

