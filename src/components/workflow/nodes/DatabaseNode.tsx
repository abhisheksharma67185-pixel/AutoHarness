'use client';

import React from 'react';
import { BaseNode, type BaseNodeData } from './BaseNode';

interface DatabaseNodeProps {
  data: BaseNodeData & {
    queryType?: string;
    tableName?: string;
    query?: string;
    dbParams?: string;
  };
}

export function DatabaseNode({ data }: DatabaseNodeProps) {
  const queryType = (data.params?.queryType as string) || data.queryType || 'SELECT';
  const tableName = (data.params?.tableName as string) || data.tableName || '';

  return (
    <BaseNode data={data}>
      <div className="mt-2 space-y-1">
        <div className="text-xs">
          <span className="font-bold text-emerald-700 bg-emerald-50 px-1 rounded mr-1">
            {queryType.toUpperCase()}
          </span>
          {tableName && (
            <span className="font-mono text-gray-700 truncate inline-block max-w-[150px] align-bottom">
              {tableName}
            </span>
          )}
        </div>
      </div>
    </BaseNode>
  );
}
