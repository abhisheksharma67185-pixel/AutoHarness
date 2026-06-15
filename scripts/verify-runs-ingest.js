const http = require('http');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const PORT = 3000;
const localDbPath = path.join(__dirname, '../autoharness.db');
const devDbPath = path.join(__dirname, '../backend/dev.db');

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

async function verifyRunsIngestion() {
  console.log('=== STARTING RUNS VIEW INGESTION & SYNC VERIFICATION ===\n');
  let passed = true;

  // 1. Read demo baseline file
  const demoPath = path.join(__dirname, '../public/demo/runs/baseline.json');
  if (!fs.existsSync(demoPath)) {
    console.error('❌ Demo baseline.json file does not exist at:', demoPath);
    process.exit(1);
  }

  const rawData = fs.readFileSync(demoPath, 'utf8');
  const payload = JSON.parse(rawData);

  // 2. Set unique run ID
  const testRunId = 'test-run-ingest-verify-' + Date.now();
  payload.run_id = testRunId;
  payload.metadata.run_label = 'Verification Ingested Run';

  console.log(`🚀 Ingesting test run: ${testRunId}...`);

  // 3. POST to /api/ingest
  const ingestRes = await makeRequest({
    hostname: 'localhost',
    port: PORT,
    path: '/api/ingest',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  }, payload);

  if (ingestRes.status === 200 && ingestRes.data && ingestRes.data.success) {
    console.log('✅ POST /api/ingest succeeded.');
  } else {
    console.error('❌ POST /api/ingest failed:', ingestRes);
    passed = false;
  }

  // 4. GET /api/runs and verify run is present
  console.log('🔍 Checking if run is listed in GET /api/runs...');
  const runsRes = await makeRequest({
    hostname: 'localhost',
    port: PORT,
    path: '/api/runs',
    method: 'GET'
  });

  if (runsRes.status === 200 && runsRes.data && Array.isArray(runsRes.data.runs)) {
    const found = runsRes.data.runs.find(r => r.run_id === testRunId);
    if (found) {
      console.log('✅ Run is successfully listed in Next.js runs API.');
    } else {
      console.error('❌ Run not found in Next.js runs API response!');
      passed = false;
    }
  } else {
    console.error('❌ GET /api/runs failed:', runsRes);
    passed = false;
  }

  // 5. Query databases directly to ensure sync
  console.log('💾 Querying local and dev databases to check sync...');
  const localDb = new Database(localDbPath);
  const devDb = new Database(devDbPath);

  const localRun = localDb.prepare('SELECT * FROM runs WHERE id = ?').get(testRunId);
  const devRun = devDb.prepare('SELECT * FROM runs WHERE id = ?').get(testRunId);

  if (localRun) {
    console.log('✅ Run successfully saved in local autoharness.db.');
  } else {
    console.error('❌ Run missing from local autoharness.db!');
    passed = false;
  }

  if (devRun) {
    console.log('✅ Run successfully replicated to backend dev.db.');
  } else {
    console.error('❌ Run missing from backend dev.db!');
    passed = false;
  }

  // Check categories, scores, and tasks
  const localTaskCount = localDb.prepare('SELECT COUNT(*) as count FROM run_tasks WHERE run_id = ?').get(testRunId).count;
  const devTaskCount = devDb.prepare('SELECT COUNT(*) as count FROM run_tasks WHERE run_id = ?').get(testRunId).count;
  console.log(`   Task counts: local=${localTaskCount}, dev=${devTaskCount}`);
  if (localTaskCount > 0 && localTaskCount === devTaskCount) {
    console.log('✅ Tasks ingested and synced successfully.');
  } else {
    console.error('❌ Task count mismatch or zero tasks ingested!');
    passed = false;
  }

  // 6. DELETE run via /api/runs
  console.log(`🗑️ Deleting test run: ${testRunId}...`);
  const deleteRes = await makeRequest({
    hostname: 'localhost',
    port: PORT,
    path: `/api/runs?run_id=${encodeURIComponent(testRunId)}`,
    method: 'DELETE'
  });

  if (deleteRes.status === 200 && deleteRes.data && deleteRes.data.success) {
    console.log('✅ DELETE /api/runs succeeded.');
  } else {
    console.error('❌ DELETE /api/runs failed:', deleteRes);
    passed = false;
  }

  // 7. Verify deletion from API and databases
  console.log('🔍 Checking if run is removed from GET /api/runs...');
  const runsResAfter = await makeRequest({
    hostname: 'localhost',
    port: PORT,
    path: '/api/runs',
    method: 'GET'
  });

  if (runsResAfter.status === 200 && runsResAfter.data && Array.isArray(runsResAfter.data.runs)) {
    const found = runsResAfter.data.runs.find(r => r.run_id === testRunId);
    if (!found) {
      console.log('✅ Run is no longer in Next.js runs API.');
    } else {
      console.error('❌ Run still exists in Next.js runs API response after deletion!');
      passed = false;
    }
  }

  const localRunAfter = localDb.prepare('SELECT * FROM runs WHERE id = ?').get(testRunId);
  const devRunAfter = devDb.prepare('SELECT * FROM runs WHERE id = ?').get(testRunId);

  if (!localRunAfter) {
    console.log('✅ Run successfully deleted from local autoharness.db.');
  } else {
    console.error('❌ Run still exists in local autoharness.db!');
    passed = false;
  }

  if (!devRunAfter) {
    console.log('✅ Run successfully deleted from backend dev.db.');
  } else {
    console.error('❌ Run still exists in backend dev.db!');
    passed = false;
  }

  // Check cascading deletes of tasks
  const localTaskCountAfter = localDb.prepare('SELECT COUNT(*) as count FROM run_tasks WHERE run_id = ?').get(testRunId).count;
  const devTaskCountAfter = devDb.prepare('SELECT COUNT(*) as count FROM run_tasks WHERE run_id = ?').get(testRunId).count;
  if (localTaskCountAfter === 0 && devTaskCountAfter === 0) {
    console.log('✅ Cascading delete verified: all tasks removed from both databases.');
  } else {
    console.error(`❌ Tasks not fully cleaned up: local=${localTaskCountAfter}, dev=${devTaskCountAfter}`);
    passed = false;
  }

  localDb.close();
  devDb.close();

  console.log('\n========================================================');
  if (passed) {
    console.log('🎉 SUCCESS: Ingestion and Sync for Runs are working perfectly! 🎉');
    process.exit(0);
  } else {
    console.log('❌ FAILURE: Problems detected in runs view ingestion or sync.');
    process.exit(1);
  }
}

verifyRunsIngestion().catch(console.error);
