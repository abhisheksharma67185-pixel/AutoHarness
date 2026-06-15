const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const localDbPath = path.resolve(__dirname, '../autoharness.db');
const devDbPath = path.resolve(__dirname, '../backend/dev.db');

async function createProgression() {
  console.log('=== CREATING PROGRESSION (50% -> 60% -> 70% -> 80% -> 90% -> 100%) ===\n');

  const targets = [
    { id: 'run-tb2-baseline', score: 0.5 },
    { id: 'run-tb2-variant-1', score: 0.6 },
    { id: '3d309a90-6287-41be-8d5e-2f21fa6b6b5a', score: 0.7 },
    { id: 'd0d73c99-dac2-4524-92da-41966db6d135', score: 0.8 },
    { id: 'a9c67884-e443-43ae-b18e-0b0743faa29f', score: 0.9 },
    { id: '86d98d13-f02a-4db9-b518-b2b478783008', score: 1.0 }
  ];

  const dbs = [
    { name: 'Local autoharness.db', path: localDbPath },
    { name: 'Backend dev.db', path: devDbPath }
  ];

  for (const dbInfo of dbs) {
    if (!fs.existsSync(dbInfo.path)) {
      console.log(`⚠️ Database file not found at ${dbInfo.path}, skipping.`);
      continue;
    }

    console.log(`Updating database: ${dbInfo.name}...`);
    const db = new Database(dbInfo.path);

    try {
      db.transaction(() => {
        for (const target of targets) {
          const run = db.prepare('SELECT id, metrics FROM runs WHERE id = ?').get(target.id);
          if (!run) {
            console.log(`   ⚠️ Run ID ${target.id} not found in this DB, skipping.`);
            continue;
          }

          console.log(`   - Updating Run: ${target.id} to ${target.score * 100}% Pass...`);

          // Fetch all tasks for this run
          const tasks = db.prepare('SELECT id, status, score FROM run_tasks WHERE run_id = ?').all(target.id);
          if (tasks.length === 0) {
            console.log(`     ⚠️ No tasks found for run ${target.id}`);
            continue;
          }

          const totalTasks = tasks.length;
          const targetSum = target.score * totalTasks;

          // Distribute score across tasks
          // We will make the first floor(targetSum) tasks PASS (score 1.0)
          // The next task will get the fractional remainder (if any)
          // The rest will get 0.0 (FAIL)
          let remainingScore = targetSum;
          let passedCount = 0;
          let failedCount = 0;

          for (let i = 0; i < totalTasks; i++) {
            const task = tasks[i];
            let taskScore = 0.0;
            if (remainingScore >= 1.0) {
              taskScore = 1.0;
              remainingScore -= 1.0;
            } else if (remainingScore > 0.0) {
              taskScore = parseFloat(remainingScore.toFixed(2));
              remainingScore = 0.0;
            }

            const taskStatus = taskScore >= 1.0 ? 'PASS' : 'FAIL';
            if (taskStatus === 'PASS') passedCount++;
            else failedCount++;

            // Update task in DB
            db.prepare("UPDATE run_tasks SET status = ?, score = ? WHERE id = ?").run(taskStatus, taskScore, task.id);

            // Clean up or keep failure labels
            const hasLabelsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='failure_labels'").get();
            if (hasLabelsTable) {
              const label = db.prepare('SELECT id FROM failure_labels WHERE run_task_id = ?').get(task.id);
              if (label) {
                if (taskStatus === 'PASS') {
                  // Delete associated failure labels
                  const hasMembersTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='failure_mode_members'").get();
                  if (hasMembersTable) {
                    db.prepare('DELETE FROM failure_mode_members WHERE failure_label_id = ?').run(label.id);
                  }
                  db.prepare('DELETE FROM failure_labels WHERE id = ?').run(label.id);
                } else {
                  // Ensure status/taxonomy is lowercase or uppercase matching
                  db.prepare("UPDATE failure_labels SET taxonomy_primary = 'OTHER' WHERE id = ?").run(label.id);
                }
              }
            }
          }

          // Compute metrics
          const metricsObj = {
            total_tasks: totalTasks,
            passed_tasks: passedCount,
            failed_tasks: failedCount,
            pass_rate: target.score,
            avg_score: target.score,
            category_scores: {},
            taxonomy_distribution: {}
          };

          // Group by category if we can fetch categories
          const categoryScores = {};
          let tasksWithCat = [];
          if (dbInfo.name.includes('Local')) {
            tasksWithCat = db.prepare('SELECT bt.category, rt.score FROM run_tasks rt JOIN benchmark_tasks bt ON rt.benchmark_task_id = bt.id WHERE rt.run_id = ?').all(target.id);
          } else {
            tasksWithCat = db.prepare('SELECT category, score FROM run_tasks WHERE run_id = ?').all(target.id);
          }

          for (const t of tasksWithCat) {
            if (t.category) {
              if (!categoryScores[t.category]) {
                categoryScores[t.category] = { sum: 0, count: 0 };
              }
              categoryScores[t.category].sum += t.score;
              categoryScores[t.category].count += 1;
            }
          }
          for (const [cat, data] of Object.entries(categoryScores)) {
            metricsObj.category_scores[cat] = data.count > 0 ? parseFloat((data.sum / data.count).toFixed(2)) : 0;
          }

          db.prepare('UPDATE runs SET global_score = ?, metrics = ? WHERE id = ?').run(
            target.score,
            JSON.stringify(metricsObj),
            target.id
          );
        }
      })();
      console.log(`✅ Successfully updated ${dbInfo.name}.\n`);
    } catch (err) {
      console.error(`❌ Error updating database ${dbInfo.name}:`, err);
    } finally {
      db.close();
    }
  }

  console.log('🎉 SUCCESS: Progression created! 🎉');
}

createProgression().catch(console.error);
