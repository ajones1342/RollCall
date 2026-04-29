import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;

// Supabase's new publishable key is preferred. Older projects still use
// the legacy anon JWT — both work with supabase-js, so accept either.
const publishableKey =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

export const supabaseConfigured = Boolean(url && publishableKey);

if (!supabaseConfigured) {
  console.warn(
    '[RollCall] Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. ' +
      'Copy .env.example to .env and fill them in, then restart the dev server. ' +
      'The app will render but auth and database calls will fail.'
  );
}

// Fall back to syntactically valid placeholders so createClient does not throw
// at module load when env is missing. Calls will fail at runtime, but the UI
// will render so you can verify the build before doing Supabase setup.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  publishableKey || 'placeholder-key'
);
