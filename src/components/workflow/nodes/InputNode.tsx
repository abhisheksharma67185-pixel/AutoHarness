'use client';

import { BaseNode, type BaseNodeData } from './BaseNode';

interface InputNodeProps {
  data: BaseNodeData & {
    outputVariable?: string;
  };
}

export function InputNode({ data }: InputNodeProps) {
  return (
    <BaseNode data={data}>
      <div className="mt-2 text-xs text-gray-500">
        {data.outputVariable && (
          <div className="font-mono bg-gray-100 inline-block px-2 py-0.5 rounded">
            → {data.outputVariable}
          </div>
        )}
      </div>
    </BaseNode>
  );
}
