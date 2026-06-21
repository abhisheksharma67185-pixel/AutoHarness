const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Try to load from .env file
try {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        let val = parts.slice(1).join('=').trim();
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    });
  }
} catch (e) {
  // Ignore
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yngvpwjlurguvdnpiegs.supabase.co";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
  console.error("Error: SUPABASE_SERVICE_ROLE_KEY is not defined in the environment or .env file.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function main() {
  console.log("=== EXAMINING EXPERIMENTS IN SUPABASE ===");

  const { data: exps, error: err1 } = await supabase
    .from('experiments')
    .select('id, name');
    
  if (err1) {
    console.error("Error fetching experiments:", err1);
    return;
  }
  
  for (const exp of exps) {
    console.log(`Experiment: ${exp.name} (ID: ${exp.id})`);
    
    const { data: vars, error: err2 } = await supabase
      .from('experiment_variants')
      .select('id, variant_label')
      .eq('experiment_id', exp.id);
      
    if (err2) {
      console.error("  Error fetching variants:", err2);
    } else {
      vars.forEach(v => {
        console.log(`  -> Variant: ${v.variant_label} (ID: ${v.id})`);
      });
    }
  }
}

main().catch(console.error);
