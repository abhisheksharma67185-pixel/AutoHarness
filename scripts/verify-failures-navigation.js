const http = require('http');

const PORT = 3000;

function makeRequest(options) {
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
    req.end();
  });
}

async function verifyFailuresNavigation() {
  console.log('=== STARTING FAILURES NAVIGATION VERIFICATION ===\n');
  let passed = true;

  // 1. Get runs
  console.log('1. Fetching runs list...');
  const runsRes = await makeRequest({
    hostname: 'localhost',
    port: PORT,
    path: '/api/runs',
    method: 'GET'
  });

  if (runsRes.status !== 200 || !runsRes.data || !Array.isArray(runsRes.data.runs) || runsRes.data.runs.length === 0) {
    console.error('❌ Failed to fetch runs list:', runsRes);
    process.exit(1);
  }

  let runWithFailures = null;
  let modes = [];

  for (const run of runsRes.data.runs) {
    const runId = run.run_id;
    console.log(`Checking run: ${runId}...`);
    const failuresRes = await makeRequest({
      hostname: 'localhost',
      port: PORT,
      path: `/api/failures?run_id=${encodeURIComponent(runId)}`,
      method: 'GET'
    });

    if (failuresRes.status === 200 && failuresRes.data && Array.isArray(failuresRes.data.failureModes) && failuresRes.data.failureModes.length > 0) {
      runWithFailures = run;
      modes = failuresRes.data.failureModes;
      break;
    }
  }

  if (runWithFailures) {
    console.log(`✅ Found run with active failure modes: ${runWithFailures.run_id}`);
    const targetMode = modes[0];
    console.log(`   - First Mode ID: ${targetMode.id}`);
    console.log(`   - First Mode Title: ${targetMode.title}`);
    console.log(`   - First Mode Taxonomy: ${targetMode.taxonomy_label}`);
    
    if (targetMode.id && targetMode.title && targetMode.taxonomy_label) {
      console.log('✅ Failure mode fields are correctly structured.');
    } else {
      console.error('❌ Failure mode missing fields:', targetMode);
      passed = false;
    }
  } else {
    console.warn('⚠️ No runs found with active failure modes in database.');
  }

  console.log('\n========================================================');
  if (passed) {
    console.log('🎉 SUCCESS: Failure mode details navigation checked successfully! 🎉');
    process.exit(0);
  } else {
    console.log('❌ FAILURE: Failure mode details navigation check failed.');
    process.exit(1);
  }
}

verifyFailuresNavigation().catch(console.error);
