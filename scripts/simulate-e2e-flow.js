/**
 * scripts/simulate-e2e-flow.js
 * Programmatically creates the E2E checklist experiments and variants
 * so they populate the database and display on the UI.
 */
const http = require('http');

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

function makePostRequest(path, body) {
  return new Promise((resolve, reject) => {
    const dataString = JSON.stringify(body);
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': dataString.length,
      },
    };

    const req = http.request(options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, rawBody: responseBody });
        }
      });
    });

    req.on('error', reject);
    req.write(dataString);
    req.end();
  });
}

async function runSimulation() {
  console.log('--- STARTING E2E FLOW SIMULATION AGAINST FRONTEND PORT 3000 ---');

  // 1. Create Git conflict validation test experiment
  console.log('\n[1] Creating "Git conflict validation test" experiment...');
  const exp1Payload = {
    action: 'create_experiment',
    name: 'Git conflict validation test',
    base_harness_version: 'v1.0.0',
    base_run_id: 'run-tb2-baseline',
    target_modes: ['fm1'], // Git Rebase and File Conflict Failures
    regression_policy: {
      guard_suites: [],
      global_min_success_rate: 0.0,
      max_regression_pct: 2.0
    }
  };
  const exp1Res = await makePostRequest('/api/experiments', expPayload = exp1Payload);
  if (exp1Res.status !== 200) {
    console.error('❌ Failed to create Experiment 1:', exp1Res.data);
    return;
  }
  const exp1Id = exp1Res.data.experiment_id;
  console.log(`✅ Created experiment. ID: ${exp1Id}`);

  // 2. Add Variant to Git conflict validation test
  console.log('\n[2] Adding variant "variant-git-conflict-fix" to Experiment 1...');
  const var1Payload = {
    action: 'add_variant',
    experiment_id: exp1Id,
    variant_label: 'variant-git-conflict-fix',
    harness_version_id: 'v1.0.0-var-1' // Maps to the seeded improved run's harness version
  };
  const var1Res = await makePostRequest('/api/experiments', var1Payload);
  if (var1Res.status !== 200) {
    console.error('❌ Failed to add Variant 1:', var1Res.data);
    return;
  }
  const var1Id = var1Res.data.variant_id;
  console.log(`✅ Added variant. ID: ${var1Id}`);

  // 3. Link Run and verify gates (Success Path)
  console.log('\n[3] Linking run "run-tb2-variant-1" to Variant 1 and running gating check...');
  const link1Payload = {
    action: 'link_run',
    experiment_id: exp1Id,
    variant_id: var1Id,
    run_id: 'run-tb2-variant-1'
  };
  const link1Res = await makePostRequest('/api/experiments', link1Payload);
  if (link1Res.status !== 200) {
    console.error('❌ Failed to link Run 1:', link1Res.data);
    return;
  }
  console.log(`✅ Gates verified. Decision: ${link1Res.data.gates_passed ? 'PROMOTED' : 'REJECTED'}`);

  // 4. Create Filesystem safety verification experiment
  console.log('\n[4] Creating "Filesystem safety verification" experiment...');
  const exp2Payload = {
    action: 'create_experiment',
    name: 'Filesystem safety verification',
    base_harness_version: 'v1.0.0',
    base_run_id: 'run-tb2-baseline',
    target_modes: ['fm5'], // Blocked system config updates
    regression_policy: {
      guard_suites: [],
      global_min_success_rate: 0.0,
      max_regression_pct: 2.0
    }
  };
  const exp2Res = await makePostRequest('/api/experiments', exp2Payload);
  if (exp2Res.status !== 200) {
    console.error('❌ Failed to create Experiment 2:', exp2Res.data);
    return;
  }
  const exp2Id = exp2Res.data.experiment_id;
  console.log(`✅ Created experiment. ID: ${exp2Id}`);

  // 5. Add Variant to Filesystem safety verification
  console.log('\n[5] Adding variant "variant-hosts-fix" to Experiment 2...');
  const var2Payload = {
    action: 'add_variant',
    experiment_id: exp2Id,
    variant_label: 'variant-hosts-fix',
    harness_version_id: 'v1.0.0-var-1'
  };
  const var2Res = await makePostRequest('/api/experiments', var2Payload);
  if (var2Res.status !== 200) {
    console.error('❌ Failed to add Variant 2:', var2Res.data);
    return;
  }
  const var2Id = var2Res.data.variant_id;
  console.log(`✅ Added variant. ID: ${var2Id}`);

  // 6. Link Run and verify gates (Failure Path)
  console.log('\n[6] Linking run "run-tb2-variant-1" to Variant 2 and running gating check...');
  const link2Payload = {
    action: 'link_run',
    experiment_id: exp2Id,
    variant_id: var2Id,
    run_id: 'run-tb2-variant-1'
  };
  const link2Res = await makePostRequest('/api/experiments', link2Payload);
  if (link2Res.status !== 200) {
    console.error('❌ Failed to link Run 2:', link2Res.data);
    return;
  }
  console.log(`✅ Gates verified. Decision: ${link2Res.data.gates_passed ? 'PROMOTED' : 'REJECTED'}`);

  console.log('\n🎉 E2E FLOW SIMULATION COMPLETED SUCCESSFULLY! 🎉');
}

runSimulation().catch(console.error);
