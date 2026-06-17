# Testing the Visual Workflow Builder

## Setup
1. Run `npm install` (installs reactflow)
2. Start Ollama: `ollama serve`
3. Run backend: `uvicorn backend.app.main:app --reload`
4. Run frontend: `npm run dev`

## Test Flow
1. Go to `/workflow` page
2. Drag Input → LLM → Output nodes
3. Connect them (click handle → drag → drop)
4. Click LLM node, select model, enter prompt
5. Click "Run Pipeline"
6. See output in results area
7. Test validation: create cycle (connect Output → Input), see red error
