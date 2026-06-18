import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error('Missing environment variable: NEXT_PUBLIC_SUPABASE_URL');
}

if (!supabaseAnonKey) {
  throw new Error('Missing environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

/**
 * Public/browser-safe Supabase client.
 * Constrained by Row Level Security (RLS) policies.
 * 
 * Safe to import in both Client Components and Server Components.
 * Can only read data from tables with SELECT policies enabled for anon.
 */
export const supabaseBrowser = createClient(supabaseUrl, supabaseAnonKey);
