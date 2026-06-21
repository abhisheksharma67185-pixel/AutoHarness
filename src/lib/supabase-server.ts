import { createClient } from '@supabase/supabase-js';

// Enforce that this module is only ever executed on the server side.
if (typeof window !== 'undefined') {
  throw new Error('CRITICAL SECURITY ERROR: supabase-server.ts imported in browser environment!');
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const isConfigured = 
  !!supabaseUrl && 
  supabaseUrl !== 'https://your-project-ref.supabase.co' &&
  !!serviceRoleKey && 
  serviceRoleKey !== 'your-supabase-service-role-key';

if (!isConfigured) {
  console.warn(
    'WARNING: Supabase is not configured or is set to placeholder values. ' +
    'Server-side Supabase client queries will fail until a valid configuration is provided and the server is restarted.'
  );
}

/**
 * Highly privileged server-only Supabase client.
 * Bypasses Row Level Security (RLS) policies.
 * 
 * USE WITH CAUTION: Only import this in Route Handlers, Server Actions,
 * or Server Components. Never expose this client or its data directly to client code.
 */
const rawClient = createClient(
  supabaseUrl || 'https://placeholder-url.supabase.co',
  serviceRoleKey || '',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

export const supabaseServer = new Proxy(rawClient, {
  get(target, prop, receiver) {
    const queryMethods = ['from', 'rpc', 'auth', 'storage', 'functions'];
    if (typeof prop === 'string' && queryMethods.includes(prop)) {
      if (!isConfigured) {
        throw new Error(
          'Supabase is not configured. Please ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in your .env file, and restart the development server.'
        );
      }
    }
    return Reflect.get(target, prop, receiver);
  }
});
