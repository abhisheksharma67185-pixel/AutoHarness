'use client';

import React, { useState } from 'react';
import { BaseNode, type BaseNodeData } from './BaseNode';
import { useOllamaModels } from '../../../hooks/useOllamaModels';
import { useOllamaGenerate } from '../../../hooks/useOllamaGenerate';

interface LLMNodeProps {
  data: BaseNodeData & {
    model?: string;
    temperature?: number;
    prompt?: string;
    result?: string;
  };
}

export function LLMNode({ data }: LLMNodeProps) {
  const { models, isLoading: isLoadingModels } = useOllamaModels();
  const { generate, isGenerating, result, error } = useOllamaGenerate();
  
  const initialModel = (data.params?.model as string) || data.model || '';
  const initialTemp = (data.params?.temperature as number) ?? data.temperature ?? 0.7;
  
  // Auto-select first available model if none selected yet
  const effectiveModel = initialModel || (models.length > 0 ? models[0].model : '');
  const prompt = (data.params?.resolvedPrompt as string) || (data.params?.prompt as string) || data.prompt || '';
  
  const [selectedModel, setSelectedModel] = useState(effectiveModel);
  const [temperature, setTemperature] = useState(initialTemp);

  const handleRun = async () => {
    if (!selectedModel || !prompt) return;
    await generate(selectedModel, prompt, temperature);
  };

  return (
    <BaseNode data={data}>
      <div className="mt-3 space-y-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-gray-500 font-medium">Model</label>
          <select
            className="text-xs border rounded p-1.5 bg-gray-50 text-gray-700 outline-none focus:ring-1 focus:ring-purple-500"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={isLoadingModels}
          >
            <option value="">Select a model...</option>
            {models.map((m) => (
              <option key={m.model} value={m.model}>{m.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between items-center">
            <label className="text-xs text-gray-500 font-medium">Temperature</label>
            <span className="text-xs font-mono text-gray-500">{temperature.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            className="accent-purple-500"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
          />
        </div>

        <button
          className="w-full bg-purple-500 text-white rounded text-xs py-1.5 font-medium hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          onClick={handleRun}
          disabled={isGenerating || !selectedModel || !prompt}
        >
          {isGenerating ? 'Generating...' : 'Run LLM'}
        </button>

        {(result || data.result) && (
          <div className="mt-2">
            <label className="text-xs text-gray-500 font-medium">Result</label>
            <textarea
              className="w-full text-xs border rounded p-1.5 mt-1 bg-gray-50 text-gray-700 resize-none outline-none"
              readOnly
              rows={4}
              value={result || data.result || ''}
            />
          </div>
        )}

        {error && (
          <div className="text-xs text-red-500 bg-red-50 p-1.5 rounded border border-red-100 mt-1">
            {error}
          </div>
        )}
      </div>
    </BaseNode>
  );
}
