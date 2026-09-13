'use strict';

const SUPABASE_URL = 'https://scgagmwcyozgevfeczam.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_P-Dk2rezeENudQPJHREvgw_Fnh-8lhn';

window.WORKSPACE_ID = '7baa2304-5cc3-42a8-bccf-9d9a3fdb3a02';

if (!window.supabase) {
  throw new Error('La bibliothèque Supabase JS n’est pas chargée.');
}

window.sbClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
