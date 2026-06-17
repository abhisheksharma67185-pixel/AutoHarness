'use client';

import React from 'react';
import { BaseNode, type BaseNodeData } from './BaseNode';

interface LogicNodeProps {
  data: BaseNodeData & {
    conditionType?: 'if' | 'and' | 'or' | 'switch';
    condition?: string;
  };
}

export function LogicNode({ data }: LogicNodeProps) {
  return (
    <BaseNode data={data}>
      <div className="mt-2">
        {data.conditionType && (
          <div className="text-xs">
            <span className="text-gray-400">Type:</span>{' '}
            <span className="font-mono text-gray-700 uppercase">{data.conditionType}</span>
          </div>
        )}
        {data.condition && (
          <div className="mt-1 text-xs">
            <span className="text-gray-400">Condition:</span>{' '}
            <span className="font-mono text-gray-700">{data.condition}</span>
          </div>
        )}
      </div>
    </BaseNode>
  );
}
