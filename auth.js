'use strict';

const authScreen = document.getElementById('authScreen');
const appShell = document.getElementById('appShell');
const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const authStatus = document.getElementById('authStatus');
const logoutButton = document.getElementById('logout');
const currentUserLabel = document.getElementById('currentUser');

function showLogin(message = '') {
  appShell.hidden = true;
  authScreen.hidden = false;
  authStatus.textContent = message;
}

async function openApp(user) {
  const { data, error } = await window.sbClient
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', window.WORKSPACE_ID)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    await window.sbClient.auth.signOut();
    throw new Error('Ce compte n’est pas autorisé à accéder à cet espace.');
  }

  currentUserLabel.textContent = user.email + ' — ' + data.role;
  authScreen.hidden = true;
  appShell.hidden = false;
  authStatus.textContent = '';
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();

  authStatus.textContent = 'Connexion…';

  try {
    const { data, error } = await window.sbClient.auth.signInWithPassword({
      email: loginEmail.value.trim(),
      password: loginPassword.value
    });

    if (error) throw error;

    await openApp(data.user);
    loginPassword.value = '';
  } catch (error) {
    showLogin(error.message || 'Connexion impossible.');
  }
});

logoutButton.addEventListener('click', async () => {
  await window.sbClient.auth.signOut();
  showLogin('Vous êtes déconnecté.');
});

async function initializeAuth() {
  try {
    const {
      data: { session },
      error
    } = await window.sbClient.auth.getSession();

    if (error) throw error;

    if (session?.user) {
      await openApp(session.user);
    } else {
      showLogin();
    }
  } catch (error) {
    showLogin(error.message || 'Erreur de connexion.');
  }
}

window.sbClient.auth.onAuthStateChange(event => {
  if (event === 'SIGNED_OUT') {
    showLogin();
  }
});

initializeAuth();
