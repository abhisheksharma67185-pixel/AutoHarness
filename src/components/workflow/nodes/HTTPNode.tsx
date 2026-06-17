'use client';

import React from 'react';
import { BaseNode, type BaseNodeData } from './BaseNode';

interface HTTPNodeProps {
  data: BaseNodeData & {
    url?: string;
    method?: string;
    headers?: string;
    body?: string;
  };
}

export function HTTPNode({ data }: HTTPNodeProps) {
  const method = (data.params?.method as string) || data.method || 'GET';
  const url = (data.params?.url as string) || data.url || '';

  return (
    <BaseNode data={data}>
      <div className="mt-2 space-y-1">
        {url && (
          <div className="text-xs">
            <span className="font-bold text-cyan-700 bg-cyan-50 px-1 rounded mr-1">
              {method.toUpperCase()}
            </span>
            <span className="font-mono text-gray-700 truncate inline-block max-w-[150px] align-bottom">
              {url}
            </span>
          </div>
        )}
      </div>
    </BaseNode>
  );
}
