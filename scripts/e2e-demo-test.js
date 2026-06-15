/**
 * e2e-demo-test.js — Simulated E2E Walkthrough and Performance Check
 * Verifies all views from the 60-minute checklist.
 */
const http = require('http');

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

function fetchEndpoint(path) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    http.get(`${BASE_URL}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const duration = Date.now() - start;
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed, duration });
        } catch (e) {
          resolve({ status: res.statusCode, rawBody: data, duration });
        }
      });
    }).on('error', reject);
  });
}

async function runE2E() {
  console.log('=== RUNNING AUTOMATED 60-MINUTE DEMO CHECKLIST TEST ===\n');
  const startTime = Date.now();
  let passed = true;

  // 1. Smoke Pass (Homepage Overview)
  console.log('[1] Smoke Pass: Loading homepage overview...');
  const overview = await fetchEndpoint('/');
  if (overview.status === 200 && overview.rawBody && overview.rawBody.includes('AutoHarness')) {
    console.log(`✅ Homepage loaded successfully in ${overview.duration}ms.`);
  } else {
    console.log(`❌ Homepage load failed. Status: ${overview.status}`);
    passed = false;
  }

  // 2. Runs Page Validation
  console.log('\n[2] Runs: Loading runs API data...');
  const runs = await fetchEndpoint('/api/runs');
  if (runs.status === 200 && runs.data && Array.isArray(runs.data.runs)) {
    const list = runs.data.runs;
    const hasBaseline = list.some(r => r.run_id === 'run-tb2-baseline');
    const hasVariant = list.some(r => r.run_id === 'run-tb2-variant-1');
    if (hasBaseline && hasVariant) {
      console.log(`✅ Ingested runs validated: baseline & variant runs found in ${runs.duration}ms.`);
    } else {
      console.log('❌ Ingested runs data mismatch: baseline or variant run missing.');
      passed = false;
    }
  } else {
    console.log(`❌ Failed to retrieve runs. Status: ${runs.status}`);
    passed = false;
  }

  // 3. Failure Clusters Validation
  console.log('\n[3] Failure Modes: Loading failure modes data...');
  const failures = await fetchEndpoint('/api/failures/modes');
  if (failures.status === 200 && failures.data && Array.isArray(failures.data.failureModes)) {
    const list = failures.data.failureModes;
    if (list.length === 6) {
      console.log(`✅ All six failure mode clusters found in ${failures.duration}ms.`);
      list.forEach((fm, idx) => {
        console.log(`   Cluster #${idx + 1}: ${fm.name} (${fm.taxonomy_label})`);
      });
    } else {
      console.log(`❌ Cluster count mismatch. Expected 6, found ${list.length}.`);
      passed = false;
    }
  } else {
    console.log(`❌ Failed to retrieve failure modes. Status: ${failures.status}`);
    passed = false;
  }

  // 4. Eval Suites Validation
  console.log('\n[4] Eval Suites: Loading eval suites data...');
  const evals = await fetchEndpoint('/api/evals');
  if (evals.status === 200 && evals.data && Array.isArray(evals.data.evalSuites)) {
    const list = evals.data.evalSuites;
    if (list.length >= 2) {
      console.log(`✅ Eval suites validated: found ${list.length} suites in ${evals.duration}ms.`);
      for (const suite of list) {
        const details = await fetchEndpoint(`/api/evals?suite_id=${encodeURIComponent(suite.id)}`);
        console.log(`   Suite "${suite.name}": Case Count = ${details.data?.cases?.length || 0}`);
      }
    } else {
      console.log(`❌ Suite count mismatch. Found ${list.length}.`);
      passed = false;
    }
  } else {
    console.log(`❌ Failed to retrieve eval suites. Status: ${evals.status}`);
    passed = false;
  }

  // 5. Experiments Validation
  console.log('\n[5] Experiments: Loading experiments scorecard...');
  const experimentDetails = await fetchEndpoint('/api/experiments?id=exp1');
  if (experimentDetails.status === 200 && experimentDetails.data) {
    const { experiment, variants } = experimentDetails.data;
    console.log(`✅ Experiment "${experiment.name}" retrieved successfully in ${experimentDetails.duration}ms.`);
    
    const variant = variants.find(v => v.id === 'ev1');
    if (variant) {
      console.log(`   Variant status: ${variant.status.toUpperCase()}`);
      console.log(`   Decision reason: ${variant.decision_reason}`);
      console.log(`   Linked Run: ${variant.run_id}`);
      
      const targetImproved = variant.target_suite_scores?.some(t => t.status === 'IMPROVED');
      const guardStable = variant.guard_suite_scores?.every(g => !g.regressed);
      
      if (variant.status === 'promoted' && targetImproved && guardStable) {
        console.log('✅ Gating scorecard validated: variant successfully promoted, targets improved, guards stable.');
      } else {
        console.log(`❌ Gating validation failed. Target improved: ${targetImproved}, Guard stable: ${guardStable}`);
        passed = false;
      }
    } else {
      console.log('❌ Candidate variant ev1 not found.');
      passed = false;
    }
  } else {
    console.log(`❌ Failed to retrieve experiments. Status: ${experimentDetails.status}`);
    passed = false;
  }

  // Final time report
  const totalDuration = Date.now() - startTime;
  console.log('\n========================================================');
  if (passed) {
    console.log(`🎉 SUCCESS: 60-minute E2E walkthrough verified clean in ${totalDuration}ms! 🎉`);
    process.exit(0);
  } else {
    console.log(`❌ FAILURE: E2E check failed. See log output above.`);
    process.exit(1);
  }
}

runE2E().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
