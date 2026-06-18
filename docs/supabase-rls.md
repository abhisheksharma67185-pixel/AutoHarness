# Supabase Row Level Security (RLS) & Client Architecture

This document describes the security model, database access policies, and client architecture used in AutoHarness Studio to protect application data in Supabase PostgreSQL.

---

## 1. Security Architecture Overview

AutoHarness Studio uses a **hybrid security model**:
* **Backend Pipeline (Python/SQLAlchemy)**: Connects directly to Supabase via the `DATABASE_URL` transaction pooler. This connection uses the database owner (`postgres` role), which bypasses all Row Level Security (RLS) policies. This is safe and necessary because the backend pipeline orchestrates heavy system execution, runs Docker containers, runs evaluations, and records results directly.
* **Next.js Frontend App**: Accesses Supabase using the Supabase Javascript SDK. Depending on the environment (server-side vs. browser-side), it uses one of two clients:
  1. **Public Browser Client (`supabaseBrowser`)**: Uses the **Anon Key** (public). Constrained fully by RLS policies. It is safe for use in client components and only permits read-only actions on public-safe tables.
  2. **Privileged Server Client (`supabaseServer`)**: Uses the **Service Role Key** (secret). Bypasses RLS policies. Imported only in server-side routes or Server Actions when writing or updating data on behalf of the application is required.

---

## 2. Row Level Security (RLS) Policies

All tables are secured with Row Level Security. The policies are defined in [001_enable_rls.sql](file:///Users/abhisheksharma/Projects/AutoHarness-Studio/supabase/migrations/001_enable_rls.sql).

### Table Access Matrix

| Table | Anon / Authenticated (Client-side) | Service Role (Server-side) | Purpose |
|---|---|---|---|
| `runs` | ✅ Read-only (`SELECT`) | ✅ Read/Write (`ALL`) | Benchmark result data |
| `run_tasks` | ✅ Read-only (`SELECT`) | ✅ Read/Write (`ALL`) | Individual task details within a run |
| `trace_steps` | ✅ Read-only (`SELECT`) | ✅ Read/Write (`ALL`) | Detailed LLM agent actions & inputs |
| `failure_labels` | ✅ Read-only (`SELECT`) | ✅ Read/Write (`ALL`) | Manually annotated failure categories |
| `jobs` | ❌ Denied (no policy) | ✅ Read/Write (`ALL`) | Internal job orchestration state |

* **Why is `jobs` blocked?** The jobs table contains details of background evaluation runs and orchestrations. Clients never need to query or update this directly.
* **Why is read-only public?** This is a demo application without a login/auth screen. Allowing client components to fetch and visualize benchmark results enables the canvas interface to work out-of-the-box.

---

## 3. How to Use the Supabase Clients in Next.js

Always import the correct client depending on where the execution happens:

### A. In Client Components (Browser)

Always use [supabase-browser.ts](file:///Users/abhisheksharma/Projects/AutoHarness-Studio/src/lib/supabase-browser.ts). This client uses the publishable anon key.

```ts
import { supabaseBrowser } from '@/lib/supabase-browser';

// Safe: RLS allows this read operation
const { data, error } = await supabaseBrowser
  .from('runs')
  .select('*')
  .limit(10);
```

### B. In Route Handlers / Server Actions (Server Only)

Always use [supabase-server.ts](file:///Users/abhisheksharma/Projects/AutoHarness-Studio/src/lib/supabase-server.ts). This client uses the service role key and has full write permissions.

> [!CAUTION]
> The service role key is a superuser secret. Never expose it in client code. `supabase-server.ts` checks if it is imported in the browser and will throw a fatal error immediately if it is.

```ts
import { supabaseServer } from '@/lib/supabase-server';

// Server-side Route Handler writing a result
export async function POST(request: Request) {
  const body = await request.json();
  
  const { data, error } = await supabaseServer
    .from('runs')
    .insert([body]);
    
  return Response.json({ data, error });
}
```

---

## 4. Tightening Policies with Authentication

If you decide to add user registration and authentication (via Supabase Auth) in a future release, you can tighten the RLS policies to restrict users to seeing only their own runs.

Here is the migration template to do so:

```sql
-- 1. Add owner_id column referencing auth.users if not exists
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) DEFAULT auth.uid();

-- 2. Drop the public read-only policy
DROP POLICY "Allow public read access on runs" ON public.runs;

-- 3. Create a policy restricting reads/writes to the owner only
CREATE POLICY "Allow users to manage their own runs" ON public.runs
    FOR ALL
    TO authenticated
    USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);
```
