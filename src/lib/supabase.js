import { createClient } from '@supabase/supabase-js';

// Strip ALL whitespace defensively. When you paste a long JWT into Vercel's
// env-var field, it often wraps mid-value and Vercel preserves the wrap as
// literal newline + indent bytes inside the stored value. Browsers then
// reject the value as an HTTP header ("Invalid value" on Headers.set).
// JWTs and URLs contain zero valid whitespace, so /\s+/g is safe here.
const url = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\s+/g, '');
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').replace(/\s+/g, '');

if (!url || !key) {
  console.warn('Supabase env missing. Copy .env.example → .env and fill in your project URL + anon key.');
}

export const supabase = createClient(url || '', key || '', {
  auth: { persistSession: false },
});

export const SUPABASE_READY = !!(url && key);
