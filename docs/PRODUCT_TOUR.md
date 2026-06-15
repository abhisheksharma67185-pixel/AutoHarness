# AutoHarness Studio — Product Tour & Demo Script

> **Purpose:** Document to prepare, rehearse, and showcase the AutoHarness Studio platform during product demonstrations and technical interviews.
> **Audience:** Core engineering team, stakeholders, and interview panels.

---

## 1. Core UX principles

AutoHarness Studio is designed as a **decision tool, not a data dump**. Every screen answers: *"What should I do next?"* in under 5 seconds.

### 1.1 Glanceability first
- KPI cards and trends form the top layer.
- Detailed tables, trajectories, and LLM logs are drill-down details.
- Each view focuses on a single core question:
  - **Home:** *"Is my agent harness getting better or worse?"*
  - **Run view:** *"Where did this agent fail and why?"*
  - **Failure modes:** *"What is systematically broken across runs?"*
  - **Eval suites:** *"What are we testing and how solid is the safety net?"*
  - **Experiments:** *"Is this candidate change safe to ship to production?"*

### 1.2 Eval UX as product UX
- Evals represent product intent, not just engineering checks.
- The UI highlights what "good" behavior is and how the promotion system enforces it.

### 1.3 Dark, calm visuals
- Dark mode default with high-contrast, harmonious badges (green/amber/red).
- Single accent color for critical actions and status indicators to minimize visual noise.

---

## 2. Screen-by-Screen UX Polish

### 2.1 Home / Overview
- **Top strip:** Big title: *“AutoHarness Studio — Terminal‑Bench 2.0”* and the harness version selector.
- **Hero Row (4 KPI cards):**
  - *Pass Rate:* Baseline vs Current variant (with delta arrow).
  - *Failures Mined:* Total count this week (with a small sparkline).
  - *Active Failure Modes:* Coherent clusters detected.
  - *Guard Suites Status:* Status indicator (All Green / Regressions Detected).
- **Second Row:**
  - *Left:* Bar chart showing "Top 5 Failure Modes by Count".
  - *Right:* "Recent Experiments" list with status pills (`Promoted` / `Rejected` / `In progress`).
- **Micro-interactions:** Hovering on a KPI card highlights the related sidebar navigation item. Clicking a failure-mode bar navigates directly to that Failure Mode's detail view.

### 2.2 Runs List & Run Detail
- **Runs List Table:** Displays Run ID/label, Harness version, Pass rate, Mined failure labels count, and Status (`Completed` / `Ingesting` / `Diagnosing`).
- **Run Detail Columns:**
  - *Left:* Summary card (pass rate, tasks count, failures count) and a `Diagnose failures` state indicator.
  - *Right:* Tabbed pane containing **Tasks** (table with status pills and failure-mode tags) and **Timeline** (trajectory step count distribution).
- **Micro-interactions:** Clicking a failed task opens a sliding drawer showing the LLM-generated diagnosis, severity, taxonomy classification, and a `View trace` expansion showing the last 20 execution steps.

### 2.3 Failure Modes
- **List View:** Impact-sorted cards (Calculated as: `count * severity_weight`). Each card shows the LLM-generated name (e.g. *“Tool misuse: wrong working directory”*), count, average severity, dominant taxonomy, and a `Create eval suite from this mode` action button.
- **Filters:** By taxonomy (`gap`, `tool_misuse`, etc.), severity, and whether a corresponding eval suite has been generated.

### 2.4 Eval Suites
- **List View:** Displays each suite with type badges (`Backbone` / `Failure-mode` / `Safety` / `Regression`), case count, and a shield icon with a `"Used to gate promotion"` tag for guard suites.
- **Detail View:** Shows last run metrics, pass rate delta trends, and a case table with links back to the originating failure labels and task logs.

### 2.5 Experiments & Promotion
- **Hero View:** Compares variants side-by-side on the **Promotion Scorecard** table:
  - Displays variant label, target delta, guard suites delta, global success delta, efficiency cost, and the final decision pill.
- **Decision Pills:** High-contrast badges: Green `Promoted`, Red `Rejected`, Grey `Pending`, with a clear, readable explanation (e.g. *“Rejected: safety guard regressed by 2.00%”*).

---

## 3. Demo Script (5–7 Minutes)

### Step 1: Setup (45s)
> **Action:** Show the Home / Overview screen.
>
> **Talk Track:**
> *"AutoHarness Studio is a self-improving platform built around AI agents. Instead of manually parsing logs or relying on synthetic prompts, AutoHarness runs agents, mines their real-world failure traces, transforms those failures into first-class evaluation suites, and runs experiments under strict, automated promotion gates. 
> 
> Everything in this demo is fully wired to Terminal-Bench 2.0 and a local llama.cpp server, creating an infrastructure-grade eval loop with zero external API costs."*

### Step 2: Home — Anchor the Story (45s)
> **Action:** Hover over the KPI cards and point to the Top 5 Failure Modes bar chart.
>
> **Talk Track:**
> *"From the Home screen, a developer can answer our first question: 'Is the harness getting better or worse?' in under five seconds. 
> 
> We see the overall pass rate, active failure modes, and the status of our guard suites. The bar chart tells us exactly what is systematically broken right now. Clicking on one of these bars takes us directly to the root cause."*

### Step 3: Run Detail & Failure Mining (1.5 min)
> **Action:** Navigate to the Runs list, click a run, and open the Tasks tab. Show the `Diagnose failures` state and click a failed task to open the drawer.
>
> **Talk Track:**
> *"Let's drill into a recent run. We see a set of failing tasks. Instead of guessing why they failed, we trigger our Failure Mining loop.
> 
> The 'Diagnose failures' job sends task trajectories to our local llama.cpp server using strict JSON schema validation. As you can see in this task drawer, it produces a structured diagnosis, taxonomy label, and severity score. By enforcing schemas, we prevent the model from emitting garbage labels and ensure we have reliable inputs for clustering."*

### Step 4: Clustering & Eval Suites (1.5 min)
> **Action:** Navigate to Failure Modes, select a card (e.g. *“Missing Required Library: Numpy”*), and point to the `Create eval suite from this mode` button.
>
> **Talk Track:**
> *"Next, we run our unsupervised clustering pipeline. The diagnoses are embedded and clustered using PCA and HDBSCAN to discover failure patterns. We then prompt the LLM once per cluster to generate a readable name and description.
> 
> To prevent these failures from ever happening again, we turn them into a test suite. Clicking 'Create eval suite' selects the representative cases closest to the cluster centroid. We've turned real-world failure data into a reusable safety net, ensuring future agent variants don't reintroduce this exact regression."*

### Step 5: Experiments & Gating Scorecard (2 min)
> **Action:** Navigate to the Experiments page and click the experiment *“Improve CWD Working Directory”*. Scroll down to show the Promotion Scorecard.
>
> **Talk Track:**
> *"Here is the hero view: the Promotion Scorecard. In AutoHarness Studio, promotions are decided by code, not vibes.
> 
> We define our experiment's regression policy: candidate variants must improve our target failure mode by at least 30%, must not drop pass rates on guard suites like safety, and must clear the global success floor.
> 
> Every variant represents a candidate configuration. When we run 'compute-promotion', the scorecard applies these gates. As you can see, Variant A is marked green as 'Promoted' because it met all delta targets. Variant B, however, is marked red as 'Rejected' because it regressed on our safety guard suite. This makes deployment automatic, safe, and completely defensible."*

### Step 6: Close (45s)
> **Action:** Navigate back to the Home page.
>
> **Talk Track:**
> *"To sum up: the loop is run, mine, cluster, build eval suites, and experiment. Because every eval suite comes from real failure traces rather than synthetic prompt cards, any performance gains we measure on this dashboard represent real problems solved.
> 
> AutoHarness Studio gives engineering teams the data fabric they need to build self-improving agents with complete confidence. Thank you."*
