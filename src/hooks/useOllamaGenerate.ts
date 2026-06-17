'use client';

import { useState, useCallback } from 'react';

export function useOllamaGenerate() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (model: string, prompt: string, temperature: number = 0.7, maxTokens?: number) => {
    setIsGenerating(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch('/api/v1/ollama/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, temperature, max_tokens: maxTokens }),
      });
      if (!res.ok) throw new Error('Generation failed');
      const data = await res.json();
      setResult(data.response);
      return data.response;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  return { generate, isGenerating, result, error };
}
