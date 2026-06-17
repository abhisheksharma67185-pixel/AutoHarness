'use client';

import { useMemo } from 'react';

export function parseVariables(text: string): string[] {
  if (!text) return [];
  const regex = /{{\s*([^}]+)\s*}}/g;
  const matches = text.match(regex) || [];
  // return unique variables
  return Array.from(new Set(matches.map((match) => match.replace(/{{\s*|\s*}}/g, '').trim())));
}

export function useVariableParser(text: string): string[] {
  return useMemo(() => parseVariables(text), [text]);
}
