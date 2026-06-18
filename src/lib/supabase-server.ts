import { createClient } from '@supabase/supabase-js';

// Enforce that this module is only ever executed on the server side.
if (typeof window !== 'undefined') {
  throw new Error('CRITICAL SECURITY ERROR: supabase-server.ts imported in browser environment!');
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('Missing environment variable: NEXT_PUBLIC_SUPABASE_URL');
}

if (!serviceRoleKey || serviceRoleKey === 'your_supabase_service_role_key_here') {
  console.warn(
    'WARNING: SUPABASE_SERVICE_ROLE_KEY is not configured or is set to placeholder. ' +
    'Server-side Supabase client writes will fail.'
  );
}

/**
 * Highly privileged server-only Supabase client.
 * Bypasses Row Level Security (RLS) policies.
 * 
 * USE WITH CAUTION: Only import this in Route Handlers, Server Actions,
 * or Server Components. Never expose this client or its data directly to client code.
 */
export const supabaseServer = createClient(supabaseUrl, serviceRoleKey || '', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
