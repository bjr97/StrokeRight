import { createClient } from '@supabase/supabase-js';

// Trim defensively — copy-paste into Vercel/local env often appends a stray
// newline or trailing space, which makes browsers reject the value as an
// HTTP header ("Invalid value" error on Headers.set).
const url = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

if (!url || !key) {
  console.warn('Supabase env missing. Copy .env.example → .env and fill in your project URL + anon key.');
}

export const supabase = createClient(url || '', key || '', {
  auth: { persistSession: false },
});

export const SUPABASE_READY = !!(url && key);
