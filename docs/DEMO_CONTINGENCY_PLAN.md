# AutoHarness Studio — Demo Contingency Plan & Storytelling Guide

This guide ensures a seamless presentation of AutoHarness Studio by outlining:
1. **Concrete Safeguards:** Checks, fallbacks, and mitigations to handle live demo issues calmly and professionally.
2. **Storytelling Narrative Structure:** A Pixar-style story spine to structure the presentation deck.
3. **Pivots & Recovery Scripts:** Exact words and actions to use if any part of the stack fails mid-demo.

---

## 1. Concrete Safeguards (Buffer for Bugs)

### 1.1 Pre-Demo Verification (30-60 Minutes Before)

Glance at this printed checklist before starting the sharing session:
- [ ] **Infrastructure Check:**
  - Colima is running: `colima status` (ensures Docker context is ready).
  - Local `llama.cpp` server is up and listening: `curl http://localhost:8080/v1/models` (returns 200).
- [ ] **Database Check:**
  - `dev.db` contains pre-seeded data (completed runs, failure labels, clustered failure modes, and experiments/variants).
- [ ] **Application Check:**
  - Backend is running on port 8001.
  - Frontend is running on port 3000.
  - Browser window is open, default is set to Dark Mode, zoom level is 100%.

### 1.2 The Walkthrough Recording (Demo Backup)
- **Mitigation:** Screen-record one complete successful run of the demo flow (from Home ➜ Run details ➜ Mine failures ➜ Cluster modes ➜ Create eval suite ➜ Run experiment ➜ Promotion decision scorecard) with audio turned off.
- **Access:** Keep the video player open in the background. If any service crashes, transition to the pre-recorded video immediately.

### 1.3 Built-in Robust Fallbacks
- **Harbor Fallback:** If the live Harbor agent execution fails or timeouts, the backend automatically copies a sample run fixture from `harbor_jobs/sample-job-20240614` to the output directory and ingests it.
- **LLM Fallback:** If the `llama.cpp` server becomes unresponsive, the diagnosis engine falls back to generic failure label structures (`"Model returned invalid structured diagnosis"`, taxonomy: `other`, severity: `medium`) without crashing.

---

## 2. Storytelling Narrative Structure

Treat the demo as a scripted narrative with the following structure:

### 2.1 The Characters & Setup
- **Hero:** An agent platform engineer at a startup trying to ship a shell-agent to production.
- **Villain:** Opaque, repeating terminal failures (like directory mismatch errors or safety boundary violations) that creep back into releases.
- **The Guide (AutoHarness Studio):** The workspace that turns unstructured logs into living test suites with promotion scorecards.

### 2.2 The Pixar-Style Story Spine

1. **Once upon a time... (The Baseline)**
   > *"Imagine you just shipped a new version of your terminal agent harness. It passes a few basic commands, but you are never quite sure if the next prompt change will introduce a regression on filesystem actions or run dangerous commands."*

2. **Every day... (The Pain)**
   > *"You scroll through hundreds of lines of execution traces, copy-paste errors into bugs, and make deployment decisions based on 'vibes' because you don't have a structured evaluation dataset derived from real incidents."*

3. **Until one day... (The Solution)**
   > *"So we built AutoHarness Studio. It connects runtime failure traces directly to reusable eval suites and gates promotions based on strict policies rather than vibes."*

4. **Because of that... (The Loop)**
   - Click **Run Detail:** *"...so you can see exactly which tasks failed and expand execution trajectories in under three clicks."*
   - Click **Diagnose Failures:** *"...so you can mine diagnoses, taxonomies, and severities automatically using a local LLM in JSON mode."*
   - Click **Failure Modes:** *"...so you can cluster semantic diagnoses using HDBSCAN and focus on patterns, not individual bugs."*
   - Click **Create Eval Suite:** *"...so you can turn centroid failure cases into a living evaluation suite that acts as a regression safety net."*
   - Click **Experiments:** *"...so you can run variant harness configurations against the same suites."*

5. **Until finally... (The Promotion Scorecard)**
   > *"When you run compute-promotion, the gating system applies your policy: candidate variants must improve target failure modes by 30% and must not regress on safety or critical suites. Variant A is promoted automatically, and Variant B is rejected with a clear explanation."*

6. **And ever since then... (The Outcome)**
   > *"Failures do not disappear into logs; they become active evaluations that protect your agentic system from regressions."*

---

## 3. Integrating Bugs into the Story (Mid-Demo Pivots)

If a service crashes or the network stalls, leverage the failure to strengthen your narrative:

### Scenario A: Local `llama.cpp` or Diagnosis Fails
- **Narrator Pivot:**
  > *"As you can see, our local LLM client is warning us of a server timeout. But because this is designed as a production-ready loop, the studio doesn't crash. It automatically falls back to schema-validated placeholder labels, allowing our clustering and evaluation loop to proceed without losing state. Let me show you how these failure modes are structured..."*

### Scenario B: Frontend or Subprocess Error
- **Narrator Pivot:**
  > *"Looks like my local Colima Docker socket had a hiccup during the live Harbor rerun. That is exactly the type of environment mismatch we build these eval guardrails to catch. Let me pivot to a recorded walkthrough of this exact online rerun so we don't lose time, and I will show you how the resulting run task results map back to the promotion scorecard..."*
- **Action:** Transition to the background video player, maximize the screen, and continue narrating.
