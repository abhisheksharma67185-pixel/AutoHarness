/**
 * scripts/verify-db-sync.js
 * Verification script to validate:
 * 1. Double-write on Next.js ingestion (writes to autoharness.db and backend/dev.db)
 * 2. Delete sync (DELETE `/api/runs` removes from both databases)
 * 3. Lazy sync from dev.db to autoharness.db on GET `/api/v1/runs/[id]` or link variant
 */
const http = require('http');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

const dbLocal = new Database(path.join(__dirname, '../autoharness.db'));
const dbDev = new Database(path.join(__dirname, '../backend/dev.db'));

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

async function verifyDbSync() {
  console.log('=== STARTING DATABASE SYNCHRONIZATION VERIFICATION ===\n');
  let passed = true;

  // Cleanup any left over verification runs
  const runId1 = 'verify-sync-run-1';
  const runId2 = 'verify-sync-run-2';
  dbLocal.prepare('DELETE FROM runs WHERE id = ?').run(runId1);
  dbLocal.prepare('DELETE FROM runs WHERE id = ?').run(runId2);
  dbDev.prepare('DELETE FROM runs WHERE id = ?').run(runId1);
  dbDev.prepare('DELETE FROM runs WHERE id = ?').run(runId2);

  // --- PART 1: DOUBLE-WRITE ON INGEST ---
  console.log('[1] Testing Double-Write on Ingest...');
  const ingestPayload = {
    run_id: runId1,
    metadata: {
      benchmark: 'Terminal-Bench 2.0',
      benchmark_slug: 'terminal_bench_2',
      agent: 'SigmaAgent',
      harness_version: 'v1.0.0-verify',
      run_label: 'Verify Double-Write Run',
      raw_artifact_uri: 's3://some-bucket/verify-1'
    },
    tasks: [
      {
        task_id: 'task_v1',
        slug: 'verify_task_slug',
        category: 'filesystem',
        difficulty: 'medium',
        score: 1.0,
        success: true,
        description: 'Verify file sync task',
        steps: []
      }
    ]
  };

  const ingestRes = await makeRequest({
    hostname: 'localhost',
    port: PORT,
    path: '/api/ingest',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, ingestPayload);

  if (ingestRes.status === 200 && ingestRes.data.success) {
    console.log('✅ Ingestion request succeeded.');
  } else {
    console.error('❌ Ingestion request failed:', ingestRes.data);
    passed = false;
  }

  // Check if run exists in autoharness.db
  const localRun = dbLocal.prepare('SELECT * FROM runs WHERE id = ?').get(runId1);
  if (localRun) {
    console.log('✅ Run successfully saved in autoharness.db.');
  } else {
    console.error('❌ Run not found in autoharness.db!');
    passed = false;
  }

  // Check if run exists in dev.db
  const devRun = dbDev.prepare('SELECT * FROM runs WHERE id = ?').get(runId1);
  if (devRun) {
    console.log('✅ Run successfully replicated to backend/dev.db.');
  } else {
    console.error('❌ Run not found in backend/dev.db!');
    passed = false;
  }

  // --- PART 2: DELETE SYNC ---
  console.log('\n[2] Testing Sync Deletion...');
  const deleteRes = await makeRequest({
    hostname: 'localhost',
    port: PORT,
    path: `/api/runs?run_id=${runId1}`,
    method: 'DELETE'
  });

  if (deleteRes.status === 200 && deleteRes.data.success) {
    console.log('✅ Delete request succeeded.');
  } else {
    console.error('❌ Delete request failed:', deleteRes.data);
    passed = false;
  }

  const localRunDeleted = dbLocal.prepare('SELECT * FROM runs WHERE id = ?').get(runId1);
  const devRunDeleted = dbDev.prepare('SELECT * FROM runs WHERE id = ?').get(runId1);

  if (!localRunDeleted && !devRunDeleted) {
    console.log('✅ Run successfully deleted from both databases.');
  } else {
    console.error(`❌ Delete failed. Local exists: ${!!localRunDeleted}, Dev exists: ${!!devRunDeleted}`);
    passed = false;
  }

  // --- PART 3: LAZY SYNC ON GET ---
  console.log('\n[3] Testing Lazy Sync from dev.db to autoharness.db on GET...');
  // Directly write to dev.db (simulating FastAPI/Python harbor-rerun generation)
  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
  dbDev.prepare(`
    INSERT INTO runs (id, job_id, benchmark_slug, run_label, agent_name, harness_version, status, global_score, metrics, raw_artifact_uri, created_at)
    VALUES (?, ?, 'terminal_bench_2', 'Verify Lazy Sync Run', 'SigmaAgent', 'v1.0.0-lazy', 'completed', 1.0, '{}', '', ?)
  `).run(runId2, runId2, nowStr);

  dbDev.prepare(`
    INSERT INTO run_tasks (id, run_id, benchmark_task_id, task_slug, category, difficulty, status, score, raw_task_json, started_at, finished_at)
    VALUES ('rt-verify-lazy', ?, 'task_lazy_1', 'lazy_task_slug', 'filesystem', 'medium', 'PASS', 1.0, '{}', ?, ?)
  `).run(runId2, nowStr, nowStr);

  // Check: it should not exist in autoharness.db yet
  const localRunBefore = dbLocal.prepare('SELECT * FROM runs WHERE id = ?').get(runId2);
  if (!localRunBefore) {
    console.log('✅ Confirm run is not in autoharness.db initially.');
  } else {
    console.error('❌ Run already exists in autoharness.db before test!');
    passed = false;
  }

  // Fetch from `/api/v1/runs/[id]` (which should trigger lazy sync)
  console.log(`Sending GET request to trigger lazy sync for run ID: ${runId2}`);
  const getRes = await makeRequest({
    hostname: 'localhost',
    port: PORT,
    path: `/api/v1/runs/${runId2}`,
    method: 'GET'
  });

  if (getRes.status === 200 && getRes.data && getRes.data.data) {
    console.log(`✅ GET request succeeded. Response Run ID: ${getRes.data.data.id}`);
  } else {
    console.error('❌ GET request failed:', getRes.status, getRes.data);
    passed = false;
  }

  // Check: it should now exist in autoharness.db
  const localRunAfter = dbLocal.prepare('SELECT * FROM runs WHERE id = ?').get(runId2);
  const localTasksAfter = dbLocal.prepare('SELECT * FROM run_tasks WHERE run_id = ?').all(runId2);
  if (localRunAfter && localTasksAfter.length > 0) {
    console.log('✅ Run and associated tasks successfully synced from dev.db to autoharness.db.');
  } else {
    console.error(`❌ Lazy sync failed. Run synced: ${!!localRunAfter}, Tasks count: ${localTasksAfter.length}`);
    passed = false;
  }

  // Clean up runId2
  dbLocal.prepare('DELETE FROM runs WHERE id = ?').run(runId2);
  dbDev.prepare('DELETE FROM runs WHERE id = ?').run(runId2);

  // Close connections
  dbLocal.close();
  dbDev.close();

  console.log('\n========================================================');
  if (passed) {
    console.log('🎉 SUCCESS: Database Synchronization is fully verified! 🎉');
    process.exit(0);
  } else {
    console.log('❌ FAILURE: Synchronization validation failed.');
    process.exit(1);
  }
}

verifyDbSync().catch(console.error);
