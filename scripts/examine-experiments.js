const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = "https://yngvpwjlurguvdnpiegs.supabase.co";
const serviceRoleKey = "REDACTED_SERVICE_ROLE_KEY";

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
