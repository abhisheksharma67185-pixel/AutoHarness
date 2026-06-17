'use client';

import { useState, useCallback, useRef } from 'react';
import { type Node, type Edge } from 'reactflow';

export function usePipelineValidation() {
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const validate = useCallback((nodes: Node[], edges: Edge[]) => {
    return new Promise<boolean>((resolve) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(async () => {
        setIsValidating(true);
        setError(null);
        try {
          const response = await fetch('/api/v1/pipelines/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nodes, edges }),
          });

          if (!response.ok) {
            const data = await response.json();
            setError(data.detail?.message || 'Validation failed');
            resolve(false);
          } else {
            resolve(true);
          }
        } catch (err: any) {
          setError(err.message || 'Validation failed');
          resolve(false);
        } finally {
          setIsValidating(false);
        }
      }, 500);
    });
  }, []);

  return { validate, isValidating, error };
}
