const http = require('http');
const Database = require('better-sqlite3');
const path = require('path');

const PORT = 3000;
const localDbPath = path.join(__dirname, '../autoharness.db');
const devDbPath = path.join(__dirname, '../backend/dev.db');

const dbLocal = new Database(localDbPath);
const dbDev = new Database(devDbPath);

function stringToIntegerId(str) {
  if (str === undefined || str === null) return 0;
  if (typeof str === 'number') return str;
  if (/^\d+$/.test(str)) {
    return parseInt(str, 10);
  }
  const prefixMatch = str.match(/^(exp|ev|er|es|ec|fl|rt|run|eres|eresult)-?(.*)$/i);
  let content = str;
  if (prefixMatch) {
    content = prefixMatch[2];
  }
  if (/^\d+$/.test(content)) {
    return parseInt(content, 10);
  }
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 1000000000;
}

function makeRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, rawBody: data });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function verifyFullDbSync() {
  console.log('=== STARTING AUTOMATED SYNC VERIFICATION ===\n');
  let passed = true;

  // Clear local experiments and eval_suites to ensure fresh sync
  dbLocal.prepare('DELETE FROM experiments').run();
  dbLocal.prepare('DELETE FROM experiment_targets').run();
  dbLocal.prepare('DELETE FROM experiment_variants').run();
  dbLocal.prepare('DELETE FROM experiment_variant_eval_summaries').run();
  dbLocal.prepare('DELETE FROM eval_suites').run();
  dbLocal.prepare('DELETE FROM eval_suite_members').run();
  dbLocal.prepare('DELETE FROM eval_cases').run();
  dbLocal.prepare('DELETE FROM eval_runs').run();
  dbLocal.prepare('DELETE FROM eval_results').run();

  console.log('🧹 Cleaned local autoharness.db experiment and eval tables.');

  // Check counts are zero
  const localExpCountBefore = dbLocal.prepare('SELECT COUNT(*) as count FROM experiments').get().count;
  const localSuiteCountBefore = dbLocal.prepare('SELECT COUNT(*) as count FROM eval_suites').get().count;

  if (localExpCountBefore === 0 && localSuiteCountBefore === 0) {
    console.log('✅ Local tables are empty as expected before sync.');
  } else {
    console.error('❌ Local tables not empty!');
    passed = false;
  }

  // --- PART 1: TEST GET /api/v1/experiments (Lazy-syncs all experiments) ---
  console.log('\n[1] Testing GET /api/v1/experiments...');
  const expListRes = await makeRequest({
    hostname: 'localhost',
    port: PORT,
    path: '/api/v1/experiments',
    method: 'GET'
  });

  if (expListRes.status === 200 && expListRes.data && Array.isArray(expListRes.data.data)) {
    console.log(`✅ GET /api/v1/experiments response succeeded. Found ${expListRes.data.data.length} experiments.`);
  } else {
    console.error('❌ GET /api/v1/experiments failed:', expListRes);
    passed = false;
  }

  // Check local database counts after sync
  const localExpCountAfter = dbLocal.prepare('SELECT COUNT(*) as count FROM experiments').get().count;
  const devExpCount = dbDev.prepare('SELECT COUNT(*) as count FROM experiments').get().count;

  if (localExpCountAfter === devExpCount && localExpCountAfter > 0) {
    console.log(`✅ Success: all ${localExpCountAfter} experiments synced to autoharness.db.`);
  } else {
    console.error(`❌ Local experiment count mismatch: local=${localExpCountAfter}, dev=${devExpCount}`);
    passed = false;
  }

  // --- PART 2: TEST GET /api/v1/experiments/[id] ---
  console.log('\n[2] Testing GET /api/v1/experiments/[id] (Single Experiment detail)...');
  // Let's clear local experiments again to test single lazy-sync
  dbLocal.prepare('DELETE FROM experiments').run();
  
  // Pick exp1 from backend, hash to local ID
  const testExpId = 'exp1';
  const localTestExpId = stringToIntegerId(testExpId);
  console.log(`Requesting experiment detail for exp${localTestExpId}`);

  const expDetailRes = await makeRequest({
    hostname: 'localhost',
    port: PORT,
    path: `/api/v1/experiments/exp${localTestExpId}`,
    method: 'GET'
  });

  if (expDetailRes.status === 200 && expDetailRes.data && expDetailRes.data.data) {
    console.log('✅ GET /api/v1/experiments/[id] response succeeded.');
    console.log('   Title:', expDetailRes.data.data.name);
  } else {
    console.error('❌ GET /api/v1/experiments/[id] failed:', expDetailRes);
    passed = false;
  }

  // Verify that it is now locally in the DB
  const localExp = dbLocal.prepare('SELECT * FROM experiments WHERE id = ?').get(localTestExpId);
  if (localExp) {
    console.log('✅ Experiment synced successfully to autoharness.db.');
  } else {
    console.error('❌ Experiment not found in local DB after request!');
    passed = false;
  }

  // --- PART 3: TEST GET /api/v1/eval-suites ---
  console.log('\n[3] Testing GET /api/v1/eval-suites...');
  const suiteListRes = await makeRequest({
    hostname: 'localhost',
    port: PORT,
    path: '/api/v1/eval-suites',
    method: 'GET'
  });

  if (suiteListRes.status === 200 && suiteListRes.data && Array.isArray(suiteListRes.data.data)) {
    console.log(`✅ GET /api/v1/eval-suites response succeeded. Found ${suiteListRes.data.data.length} suites.`);
  } else {
    console.error('❌ GET /api/v1/eval-suites failed:', suiteListRes);
    passed = false;
  }

  const localSuiteCountAfter = dbLocal.prepare('SELECT COUNT(*) as count FROM eval_suites').get().count;
  const devSuiteCount = dbDev.prepare('SELECT COUNT(*) as count FROM eval_suites').get().count;

  if ((localSuiteCountAfter === devSuiteCount || localSuiteCountAfter === devSuiteCount + 1) && localSuiteCountAfter > 0) {
    console.log(`✅ Success: all ${localSuiteCountAfter} eval suites synced to autoharness.db.`);
  } else {
    console.error(`❌ Local suite count mismatch: local=${localSuiteCountAfter}, dev=${devSuiteCount}`);
    passed = false;
  }

  // Check that eval cases were synced too
  const localCasesCount = dbLocal.prepare('SELECT COUNT(*) as count FROM eval_cases').get().count;
  console.log(`   Local eval cases synced count: ${localCasesCount}`);
  if (localCasesCount > 0) {
    console.log('✅ Eval cases synced successfully.');
  } else {
    console.error('❌ No eval cases synced!');
    passed = false;
  }

  // --- PART 4: TEST GET /api/v1/eval-runs/[id] ---
  console.log('\n[4] Testing GET /api/v1/eval-runs/[id]...');
  // Pick an eval run from backend database
  const devEvalRun = dbDev.prepare('SELECT id FROM eval_runs LIMIT 1').get();
  if (devEvalRun) {
    const localEvalRunId = stringToIntegerId(devEvalRun.id);
    console.log(`Requesting eval run detail for er${localEvalRunId} (dev ID: ${devEvalRun.id})`);

    const erRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/v1/eval-runs/er${localEvalRunId}`,
      method: 'GET'
    });

    if (erRes.status === 200 && erRes.data && erRes.data.data) {
      console.log('✅ GET /api/v1/eval-runs/[id] succeeded.');
      console.log('   Status:', erRes.data.data.status);
    } else {
      console.error('❌ GET /api/v1/eval-runs/[id] failed:', erRes);
      passed = false;
    }

    const localEr = dbLocal.prepare('SELECT * FROM eval_runs WHERE id = ?').get(localEvalRunId);
    if (localEr) {
      console.log('✅ Eval run successfully synced to autoharness.db.');
    } else {
      console.error('❌ Eval run not found in local DB after request!');
      passed = false;
    }

    // --- PART 5: TEST GET /api/v1/eval-runs/[id]/results ---
    console.log('\n[5] Testing GET /api/v1/eval-runs/[id]/results...');
    const resultsRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/v1/eval-runs/er${localEvalRunId}/results`,
      method: 'GET'
    });

    if (resultsRes.status === 200 && resultsRes.data && Array.isArray(resultsRes.data.data)) {
      console.log(`✅ GET /api/v1/eval-runs/[id]/results succeeded. Found ${resultsRes.data.data.length} results.`);
    } else {
      console.error('❌ GET /api/v1/eval-runs/[id]/results failed:', resultsRes);
      passed = false;
    }

    const localResultsCount = dbLocal.prepare('SELECT COUNT(*) as count FROM eval_results WHERE eval_run_id = ?').get(localEvalRunId).count;
    if (localResultsCount > 0) {
      console.log(`✅ Eval run results synced successfully (count: ${localResultsCount}).`);
    } else {
      console.error('❌ No eval results synced to local DB!');
      passed = false;
    }
  } else {
    console.warn('⚠️ No eval runs found in dev.db to test lazy-sync of eval runs.');
  }

  // Close connections
  dbLocal.close();
  dbDev.close();

  console.log('\n========================================================');
  if (passed) {
    console.log('🎉 SUCCESS: Full Database Synchronization is verified! 🎉');
    process.exit(0);
  } else {
    console.log('❌ FAILURE: Full synchronization verification failed.');
    process.exit(1);
  }
}

verifyFullDbSync().catch(console.error);
