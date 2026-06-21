import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const isConfigured = 
  !!supabaseUrl && 
  supabaseUrl !== 'https://your-project-ref.supabase.co' &&
  !!supabaseAnonKey && 
  supabaseAnonKey !== 'your-supabase-anon-key';

if (!isConfigured && typeof window !== 'undefined') {
  console.warn(
    'WARNING: Supabase is not configured. Public/browser queries will fail.'
  );
}

/**
 * Public/browser-safe Supabase client.
 * Constrained by Row Level Security (RLS) policies.
 * 
 * Safe to import in both Client Components and Server Components.
 * Can only read data from tables with SELECT policies enabled for anon.
 */
const rawClient = createClient(
  supabaseUrl || 'https://placeholder-url.supabase.co',
  supabaseAnonKey || ''
);

export const supabaseBrowser = new Proxy(rawClient, {
  get(target, prop, receiver) {
    const queryMethods = ['from', 'rpc', 'auth', 'storage', 'functions'];
    if (typeof prop === 'string' && queryMethods.includes(prop)) {
      if (!isConfigured) {
        throw new Error(
          'Supabase browser client is not configured. Please check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your env configuration.'
        );
      }
    }
    return Reflect.get(target, prop, receiver);
  }
});
