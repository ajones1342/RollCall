import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

if (!supabaseConfigured) {
  console.warn(
    '[RollCall] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env and fill them in, then restart the dev server. ' +
      'The app will render but auth and database calls will fail.'
  );
}

// Fall back to syntactically valid placeholders so createClient does not throw
// at module load when env is missing. Calls will fail at runtime, but the UI
// will render so you can verify the build before doing Supabase setup.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder-anon-key'
);
