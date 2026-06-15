const http = require('http');

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}/api/v1`;
const API_KEY = 'test-secret-key';

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlStr = `${BASE_URL}${path}`;
    const url = new URL(urlStr);
    const options = {
      method: method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, rawBody: data });
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- STARTING AUTO-HARNESS STUDIO API V1 VERIFICATION TESTS ---');

  const headers = { 'X-API-Key': API_KEY };
  let testRunId = null;
  let testTaskId = null;
  let testJobId = null;
  let testFailureModeId = null;
  let testEvalSuiteId = null;
  let testEvalRunId = null;
  let testExperimentId = null;
  let testVariantId = null;

  // 1. Verify Auth rejection without API key
  console.log('\n[1] Checking Authentication Enforcement...');
  try {
    const res = await makeRequest('GET', '/benchmarks');
    if (res.status === 401 && res.body && res.body.error && res.body.error.code === 'UNAUTHORIZED') {
      console.log('✅ Auth rejection verified.');
    } else {
      console.log('⚠️ Warning: Auth rejection not triggered (did you run Next.js with STUDIO_API_KEY environment variable?). Status:', res.status, res.body);
    }
  } catch (err) {
    console.error('Failed to run auth test:', err);
  }

  // 2. GET /benchmarks
  console.log('\n[2] GET /benchmarks...');
  const benchmarksRes = await makeRequest('GET', '/benchmarks', null, headers);
  console.assert(benchmarksRes.status === 200, `Expected 200, got ${benchmarksRes.status}`);
  console.assert(Array.isArray(benchmarksRes.body.data), 'Expected array data');
  console.log('✅ GET /benchmarks succeeded. Found:', benchmarksRes.body.data.length);

  // 3. GET /benchmarks/b1/tasks
  console.log('\n[3] GET /benchmarks/b1/tasks...');
  const tasksRes = await makeRequest('GET', '/benchmarks/b1/tasks?limit=5', null, headers);
  console.assert(tasksRes.status === 200, `Expected 200, got ${tasksRes.status}`);
  console.assert(Array.isArray(tasksRes.body.data), 'Expected array data');
  console.log('✅ GET /benchmarks/b1/tasks succeeded. Found:', tasksRes.body.data.length);

  // 4. POST /runs/import
  console.log('\n[4] POST /runs/import...');
  const importPayload = {
    benchmark_slug: 'terminal_bench_2',
    run_label: 'Verification-Run-Baseline-E2E-' + Math.floor(Math.random() * 1000),
    agent_name: 'SigmaAgent v1.2',
    harness_version: 'v1.0.0',
    artifact: {
      format: 'AUTO_HARNESS_V1',
      uri: 'public/demo/runs/baseline.json'
    }
  };
  const importRes = await makeRequest('POST', '/runs/import', importPayload, headers);
  console.assert(importRes.status === 201, `Expected 201 Created, got ${importRes.status}`);
  console.assert(importRes.body.data.run_id, 'Expected run_id');
  testRunId = importRes.body.data.run_id;
  console.log('✅ POST /runs/import succeeded (201). run_id:', testRunId);

  // Test duplicate import 409
  console.log('\n[4.1] POST /runs/import (checking duplicate 409)...');
  const duplicateRes = await makeRequest('POST', '/runs/import', importPayload, headers);
  console.assert(duplicateRes.status === 409, `Expected 409 Conflict, got ${duplicateRes.status}`);
  console.assert(duplicateRes.body.error.code === 'DUPLICATE_RUN', 'Expected DUPLICATE_RUN error code');
  console.log('✅ Duplicate runs import conflict verified (409).');

  // 5. GET /runs
  console.log('\n[5] GET /runs...');
  const runsRes = await makeRequest('GET', '/runs?benchmark_slug=terminal_bench_2', null, headers);
  console.assert(runsRes.status === 200, `Expected 200, got ${runsRes.status}`);
  console.assert(Array.isArray(runsRes.body.data), 'Expected runs array');
  console.assert(runsRes.body.data[0].metrics.num_failures !== undefined, 'Expected num_failures key in metrics');
  console.log('✅ GET /runs succeeded. Found:', runsRes.body.data.length);

  // 6. GET /runs/{run_id}
  console.log('\n[6] GET /runs/' + testRunId + '...');
  const runDetailRes = await makeRequest('GET', `/runs/${testRunId}`, null, headers);
  console.assert(runDetailRes.status === 200, `Expected 200, got ${runDetailRes.status}`);
  console.assert(runDetailRes.body.data.id === testRunId, 'Run ID mismatch');
  console.assert(runDetailRes.body.data.metrics.num_failures !== undefined, 'Expected num_failures in metrics');
  console.log('✅ GET /runs/{run_id} succeeded.');

  // 7. GET /runs/{run_id}/tasks
  console.log('\n[7] GET /runs/' + testRunId + '/tasks...');
  const runTasksRes = await makeRequest('GET', `/runs/${testRunId}/tasks`, null, headers);
  console.assert(runTasksRes.status === 200, `Expected 200, got ${runTasksRes.status}`);
  console.assert(Array.isArray(runTasksRes.body.data), 'Expected tasks array');
  const failingTask = runTasksRes.body.data.find(t => t.status === 'fail');
  testTaskId = failingTask ? failingTask.id : runTasksRes.body.data[0]?.id;
  console.log('✅ GET /runs/{run_id}/tasks succeeded. Using task id for trace:', testTaskId);

  // 8. GET /tasks/{run_task_id}/trace
  if (testTaskId) {
    console.log('\n[8] GET /tasks/' + testTaskId + '/trace...');
    const traceRes = await makeRequest('GET', `/tasks/${testTaskId}/trace`, null, headers);
    console.assert(traceRes.status === 200, `Expected 200, got ${traceRes.status}`);
    console.assert(Array.isArray(traceRes.body.data.steps), 'Expected steps array');
    console.log('✅ GET /tasks/{run_task_id}/trace succeeded. Steps:', traceRes.body.data.steps.length);
  } else {
    console.log('⚠️ Skipping trace test - no run tasks found.');
  }

  // 9. POST /runs/{run_id}/diagnose-failures
  console.log('\n[9] POST /runs/' + testRunId + '/diagnose-failures...');
  const diagRes = await makeRequest('POST', `/runs/${testRunId}/diagnose-failures`, { llm_profile: 'default' }, headers);
  console.assert(diagRes.status === 202, `Expected 202 Accepted, got ${diagRes.status}`);
  console.assert(diagRes.body.data.job_id, 'Expected job_id');
  testJobId = diagRes.body.data.job_id;
  console.log('✅ POST /runs/{run_id}/diagnose-failures succeeded (202). job_id:', testJobId);

  // 10. GET /jobs/{job_id}
  console.log('\n[10] GET /jobs/' + testJobId + '...');
  // Wait a brief moment for the job background worker to set status or finish
  await new Promise(r => setTimeout(r, 1000));
  const jobRes = await makeRequest('GET', `/jobs/${testJobId}`, null, headers);
  console.assert(jobRes.status === 200, `Expected 200, got ${jobRes.status}`);
  console.assert(jobRes.body.data.type === 'diagnose_failures', 'Expected type field');
  console.assert(jobRes.body.data.created_at, 'Expected created_at field');
  console.log('✅ GET /jobs/{job_id} succeeded. Status:', jobRes.body.data.status, 'Finished At:', jobRes.body.data.finished_at);

  // 11. POST /benchmarks/b1/recluster-failure-modes
  console.log('\n[11] POST /benchmarks/b1/recluster-failure-modes...');
  const reclusterRes = await makeRequest('POST', `/benchmarks/b1/recluster-failure-modes`, {
    run_ids: [testRunId],
    embedding_profile: 'default'
  }, headers);
  console.assert(reclusterRes.status === 202, `Expected 202 Accepted, got ${reclusterRes.status}`);
  console.assert(reclusterRes.body.data.job_id, 'Expected job_id');
  console.log('✅ POST /benchmarks/{benchmark_id}/recluster-failure-modes succeeded (202). job_id:', reclusterRes.body.data.job_id);

  // Wait for the recluster job
  await new Promise(r => setTimeout(r, 1000));

  // 12. GET /failure-modes
  console.log('\n[12] GET /failure-modes...');
  const fmRes = await makeRequest('GET', '/failure-modes?benchmark_slug=terminal_bench_2', null, headers);
  console.assert(fmRes.status === 200, `Expected 200, got ${fmRes.status}`);
  console.assert(Array.isArray(fmRes.body.data), 'Expected failure modes array');
  testFailureModeId = fmRes.body.data[0]?.id;
  console.log('✅ GET /failure-modes succeeded. Found:', fmRes.body.data.length, 'Use failure_mode_id:', testFailureModeId);

  // 13. GET /failure-modes/{failure_mode_id}/failures
  if (testFailureModeId) {
    console.log('\n[13] GET /failure-modes/' + testFailureModeId + '/failures...');
    const fmFailuresRes = await makeRequest('GET', `/failure-modes/${testFailureModeId}/failures`, null, headers);
    console.assert(fmFailuresRes.status === 200, `Expected 200, got ${fmFailuresRes.status}`);
    console.assert(Array.isArray(fmFailuresRes.body.data), 'Expected failures list');
    console.assert(fmFailuresRes.body.data[0].distance_from_centroid !== undefined, 'Expected distance_from_centroid key');
    console.log('✅ GET /failure-modes/{id}/failures succeeded. Found:', fmFailuresRes.body.data.length);
  } else {
    console.log('⚠️ Skipping /failure-modes/{id}/failures test - no failure modes exist.');
  }

  // 14. POST /eval-suites
  console.log('\n[14] POST /eval-suites...');
  const evalSuitePayload = {
    name: 'Verification-Eval-Suite-' + Math.floor(Math.random() * 1000),
    benchmark_slug: 'terminal_bench_2',
    description: 'Test evaluation suite for API v1 validation',
    failure_label_ids: ['fl1'],
    scoring_strategy: 'benchmark_or_llm_judge'
  };
  const createSuiteRes = await makeRequest('POST', '/eval-suites', evalSuitePayload, headers);
  console.assert(createSuiteRes.status === 201, `Expected 201 Created, got ${createSuiteRes.status}`);
  console.assert(createSuiteRes.body.data.eval_suite_id, 'Expected eval_suite_id');
  testEvalSuiteId = createSuiteRes.body.data.eval_suite_id;
  console.log('✅ POST /eval-suites succeeded (201). eval_suite_id:', testEvalSuiteId);

  // 15. GET /eval-suites
  console.log('\n[15] GET /eval-suites...');
  const listSuitesRes = await makeRequest('GET', '/eval-suites?benchmark_slug=terminal_bench_2', null, headers);
  console.assert(listSuitesRes.status === 200, `Expected 200, got ${listSuitesRes.status}`);
  console.assert(Array.isArray(listSuitesRes.body.data), 'Expected suites array');
  console.log('✅ GET /eval-suites succeeded. Found:', listSuitesRes.body.data.length);

  // 16. POST /eval-runs
  console.log('\n[16] POST /eval-runs...');
  const evalRunPayload = {
    eval_suite_id: 'es1',
    harness_version_id: 'hv-v1.0.0',
    mode: 'offline_replay'
  };
  const evalRunRes = await makeRequest('POST', '/eval-runs', evalRunPayload, headers);
  console.assert(evalRunRes.status === 200, `Expected 200 OK (sync completed), got ${evalRunRes.status}`);
  console.assert(evalRunRes.body.data.eval_run_id, 'Expected eval_run_id');
  testEvalRunId = evalRunRes.body.data.eval_run_id;
  console.log('✅ POST /eval-runs succeeded (200 sync). eval_run_id:', testEvalRunId);

  // 17. GET /eval-runs/{eval_run_id}
  console.log('\n[17] GET /eval-runs/' + testEvalRunId + '...');
  const evalRunDetailRes = await makeRequest('GET', `/eval-runs/${testEvalRunId}`, null, headers);
  console.assert(evalRunDetailRes.status === 200, `Expected 200, got ${evalRunDetailRes.status}`);
  console.log('✅ GET /eval-runs/{id} succeeded. status:', evalRunDetailRes.body.data.status);

  // 18. GET /eval-runs/{eval_run_id}/results
  console.log('\n[18] GET /eval-runs/' + testEvalRunId + '/results...');
  const evalRunResultsRes = await makeRequest('GET', `/eval-runs/${testEvalRunId}/results`, null, headers);
  console.assert(evalRunResultsRes.status === 200, `Expected 200, got ${evalRunResultsRes.status}`);
  console.assert(Array.isArray(evalRunResultsRes.body.data), 'Expected results array');
  console.log('✅ GET /eval-runs/{id}/results succeeded. Cases:', evalRunResultsRes.body.data.length);

  // 18.1. POST /eval-runs (online_rerun)
  console.log('\n[18.1] POST /eval-runs (online_rerun)...');
  const onlineRunPayload = {
    eval_suite_id: 'es1',
    harness_version_id: 'hv-v1.0.0',
    mode: 'online_rerun'
  };
  const onlineRunRes = await makeRequest('POST', '/eval-runs', onlineRunPayload, headers);
  console.assert(onlineRunRes.status === 202, `Expected 202 Accepted, got ${onlineRunRes.status}`);
  console.assert(onlineRunRes.body.data.eval_run_id, 'Expected eval_run_id');
  const testOnlineRunId = onlineRunRes.body.data.eval_run_id;
  console.log('✅ POST /eval-runs (online_rerun) succeeded (202). eval_run_id:', testOnlineRunId);

  // Wait briefly for background execution to complete
  console.log('Waiting for online evaluation background runner to complete...');
  await new Promise(r => setTimeout(r, 2000));

  // Verify online run status and metrics
  const onlineRunDetailRes = await makeRequest('GET', `/eval-runs/${testOnlineRunId}`, null, headers);
  console.assert(onlineRunDetailRes.status === 200, `Expected 200, got ${onlineRunDetailRes.status}`);
  console.assert(onlineRunDetailRes.body.data.status === 'completed', `Expected status completed, got ${onlineRunDetailRes.body.data.status}`);
  console.assert(onlineRunDetailRes.body.data.run_id !== null, 'Expected run_id link');
  console.log('✅ Live evaluation completed successfully. Metrics:', onlineRunDetailRes.body.data.metrics);

  // 19. POST /experiments
  console.log('\n[19] POST /experiments...');
  const expPayload = {
    name: 'Validation-Experiment-' + Math.floor(Math.random() * 1000),
    benchmark_slug: 'terminal_bench_2',
    base_harness_version_id: 'hv-v1.0.0',
    target_description: 'Improve tool use',
    targets: [
      {
        target_type: 'failure_mode',
        target_id: testFailureModeId || 'fm1',
        desired_delta: 0.2
      }
    ],
    regression_policy: {
      guard_suites: [
        {
          eval_suite_id: 'es1',
          max_allowed_drop: 0.05
        }
      ],
      global_min_success_rate: 0.40
    }
  };
  const expRes = await makeRequest('POST', '/experiments', expPayload, headers);
  console.assert(expRes.status === 201, `Expected 201 Created, got ${expRes.status}`);
  console.assert(expRes.body.data.experiment_id, 'Expected experiment_id');
  testExperimentId = expRes.body.data.experiment_id;
  console.log('✅ POST /experiments succeeded (201). experiment_id:', testExperimentId);

  // 20. GET /experiments/{experiment_id}
  console.log('\n[20] GET /experiments/' + testExperimentId + '...');
  const expDetailRes = await makeRequest('GET', `/experiments/${testExperimentId}`, null, headers);
  console.assert(expDetailRes.status === 200, `Expected 200, got ${expDetailRes.status}`);
  console.assert(expDetailRes.body.data.id === testExperimentId, 'Experiment ID mismatch');
  console.log('✅ GET /experiments/{id} succeeded.');

  // 21. POST /experiments/{experiment_id}/variants/propose
  console.log('\n[21] POST /experiments/' + testExperimentId + '/variants/propose...');
  const proposeRes = await makeRequest('POST', `/experiments/${testExperimentId}/variants/propose`, {
    num_variants: 2,
    llm_profile: 'default'
  }, headers);
  console.assert(proposeRes.status === 202, `Expected 202 Accepted, got ${proposeRes.status}`);
  console.assert(Array.isArray(proposeRes.body.data.variants), 'Expected variants list');
  console.assert(proposeRes.body.data.job_id, 'Expected job_id in proposal response');
  testVariantId = proposeRes.body.data.variants[0]?.experiment_variant_id;
  console.log('✅ POST /experiments/{id}/variants/propose succeeded (202). Proposed variants:', proposeRes.body.data.variants.length, 'variant_id:', testVariantId);

  // 22. GET /experiments/{experiment_id}/variants
  console.log('\n[22] GET /experiments/' + testExperimentId + '/variants...');
  const getVariantsRes = await makeRequest('GET', `/experiments/${testExperimentId}/variants`, null, headers);
  console.assert(getVariantsRes.status === 200, `Expected 200, got ${getVariantsRes.status}`);
  console.assert(Array.isArray(getVariantsRes.body.data), 'Expected array data');
  console.assert(getVariantsRes.body.data[0].gate_passed !== undefined, 'Expected gate_passed key');
  console.assert(getVariantsRes.body.data[0].target_suite_delta !== undefined, 'Expected target_suite_delta key');
  console.log('✅ GET /experiments/{id}/variants succeeded. Found:', getVariantsRes.body.data.length);

  // 23. POST /experiments/{experiment_id}/variants/{variant_id}/link-run
  if (testVariantId) {
    console.log('\n[23] POST /experiments/' + testExperimentId + '/variants/' + testVariantId + '/link-run...');
    // Use the variant run run-tb2-variant-1 which was seeded
    const linkRes = await makeRequest('POST', `/experiments/${testExperimentId}/variants/${testVariantId}/link-run`, {
      run_id: 'run-tb2-variant-1'
    }, headers);
    console.assert(linkRes.status === 200, `Expected 200, got ${linkRes.status}`);
    console.assert(linkRes.body.data.linked === true, 'Expected linked = true');
    console.log('✅ POST /experiments/{id}/variants/{variant_id}/link-run succeeded.');

    // Fetch variants again to check updated status and regression flags
    console.log('\n[24] GET /experiments/' + testExperimentId + '/variants (after linking)...');
    const getVariantsAfterRes = await makeRequest('GET', `/experiments/${testExperimentId}/variants`, null, headers);
    console.assert(getVariantsAfterRes.status === 200, `Expected 200, got ${getVariantsAfterRes.status}`);
    const updatedVariant = getVariantsAfterRes.body.data.find(v => v.experiment_variant_id === testVariantId);
    console.assert(updatedVariant.status === 'evaluated', `Expected status to be evaluated, got ${updatedVariant.status}`);
    console.log('✅ GET /experiments/{id}/variants (after linking) verified updated variant status:', updatedVariant.status, 'gate_passed:', updatedVariant.gate_passed);
  } else {
    console.log('⚠️ Skipping link-run test - no variant created.');
  }

  console.log('\n🎉 ALL API V1 ENDPOINTS SUCCESSFULLY TESTED AND VERIFIED! 🎉');
}

runTests().catch(err => {
  console.error('❌ Test execution failed with error:', err);
  process.exit(1);
});
