# Testing Pipeline Execution (AutoHarness 2.0)

## Setup
1. Run `npm install` (installs reactflow)
2. Start Ollama: `ollama serve`
3. Pull a model: `ollama pull llama3.1`
4. Run backend: `uvicorn backend.app.main:app --reload`
5. Run frontend: `npm run dev`
6. Go to `/workflow` page

## Test Case 1: Simple Pipeline (Input → LLM → Output)

**Steps:**
1. Drag Input node onto canvas
2. Drag LLM node onto canvas
3. Drag Output node onto canvas
4. Connect Input → LLM (click Input right handle → drag to LLM left handle)
5. Connect LLM → Output (click LLM right handle → drag to Output left handle)
6. Click Input node, in PropertiesPanel enter: `value: "hello"`
7. Click LLM node, in PropertiesPanel:
   - Model: `llama3.1`
   - Temperature: `0.2`
   - Prompt: `Say "hi" back to me`
8. Click "Run Pipeline" button

**Expected Result:**
- Logs area shows:
Step 1: Input → value: “hello”
Step 2: LLM → response: “hi”
Step 3: Output → final result: “hi”
- Result area shows: `"hi"`
- No errors

## Test Case 2: Pipeline with Variable Replacement (Input → Text → LLM → Output)

**Steps:**
1. Drag Input node
2. Drag Text node
3. Drag LLM node
4. Drag Output node
5. Connect: Input → Text → LLM → Output
6. Click Input, enter: `value: "John"`
7. Click Text, enter: `text: "Hello {{ value }}, how are you?"`
8. Click LLM:
 - Model: `llama3.1`
 - Prompt: `Reply to: {{ text }}` (where `text` comes from Text node)
9. Click "Run Pipeline"

**Expected Result:**
- Logs area shows:
Step 1: Input → value: “John”
Step 2: Text → output: “Hello John, how are you?”
Step 3: LLM → response: “I’m good, thanks!”
Step 4: Output → final result: “I’m good, thanks!”
- `{{ value }}` in Text node is replaced with "John"
- No errors

## Test Case 3: Error Handling (Broken Pipeline)

**Steps:**
1. Create pipeline: Input → LLM
2. Click LLM, set model to: `invalid-model-name-12345`
3. Click "Run Pipeline"

**Expected Result:**
- Logs area shows error: `"LLM failed: model not found"`
- Result area shows: `success: false`
- Red error banner appears

## Test Case 4: Multiple Inputs to Single Node

**Steps:**
1. Drag 2 Input nodes
2. Drag 1 Text node
3. Connect: Input1 → Text, Input2 → Text
4. Click Input1, enter: `value: "hello"`
5. Click Input2, enter: `value: "world"`
6. Click Text, enter: `text: "Say {{ value1 }} and {{ value2 }}"`
7. Click "Run Pipeline"

**Expected Result:**
- Text node receives array: `["hello", "world"]`
- Output shows combined result

## Success Criteria

✅ All 4 test cases pass
✅ Logs show correct step-by-step output
✅ Variable replacement works (`{{ value }}`)
✅ Errors handled gracefully
✅ No TypeScript errors in console

## Notes

- If Ollama is not running, start it: `ollama serve`
- If model not found, pull it: `ollama pull llama3.1`