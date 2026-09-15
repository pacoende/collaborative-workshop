'use strict';
// Start the workspace only after membership is verified and the shell is visible.
(() => {
  const $=id=>document.getElementById(id),sb=window.sbClient;
  let revision=0,active=null;
  function showLogin(message=''){$('appShell').hidden=true;$('authScreen').hidden=false;$('authStatus').textContent=message}
  async function sync(user){
    const token=++revision;
    if(!user){active=null;window.workshop.stop();showLogin();return}
    if(active===user.id)return;
    window.workshop.stop();$('appShell').hidden=true;
    try{
      const {data,error}=await sb.from('workspace_members').select('role').eq('workspace_id',window.WORKSPACE_ID).eq('user_id',user.id).maybeSingle();
      if(token!==revision)return;if(error)throw error;if(!data)throw Error('Ce compte n’est pas membre de cet espace.');
      active=user.id;$('currentUser').textContent=user.email+' — '+data.role;
      $('authScreen').hidden=true;$('appShell').hidden=false;$('authStatus').textContent='';
      await window.workshop.start(user);
    }catch(error){if(token!==revision)return;active=null;window.workshop.stop();showLogin(error.message||'Connexion impossible.')}
  }
  $('loginForm').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;$('authStatus').textContent='Connexion…';
    try{const {data,error}=await sb.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPassword').value});if(error)throw error;
      $('loginPassword').value='';await sync(data.user);
    }catch(error){showLogin(error.message||'Connexion impossible.')}finally{button.disabled=false}
  };
  $('logout').onclick=async()=>{
    if(window.workshop.hasPending()){$('status').textContent='Un envoi ou un brouillon est encore en attente. Terminez-le ou exportez vos brouillons avant de quitter.';return}
    const {error}=await sb.auth.signOut();if(error){$('status').textContent='Déconnexion impossible. Réessayez.';return}sync(null);
  };
  sb.auth.onAuthStateChange((event,session)=>{
    // Defer network work outside the Supabase auth callback to avoid its session lock.
    if(['SIGNED_IN','SIGNED_OUT','INITIAL_SESSION'].includes(event))setTimeout(()=>sync(session?.user||null),0);
  });
  sb.auth.getSession().then(({data,error})=>{if(error)showLogin(error.message);else sync(data.session?.user||null)}).catch(e=>showLogin(e.message));
})();
