'use client';

import { BaseNode, type BaseNodeData } from './BaseNode';

interface OutputNodeProps {
  data: BaseNodeData & {
    inputVariables?: string[];
  };
}

export function OutputNode({ data }: OutputNodeProps) {
  const result = data.params?.result as string;

  return (
    <BaseNode data={data}>
      <div className="mt-2 text-xs text-gray-500">
        {data.inputVariables && data.inputVariables.length > 0 && (
          <div className="space-y-0.5">
            {data.inputVariables.map((varName, idx) => (
              <div key={idx}>← {varName}</div>
            ))}
          </div>
        )}
      </div>

      {result && (
        <div className="mt-2">
          <label className="text-xs text-gray-500 font-medium">Final Result</label>
          <textarea
            className="w-full text-xs border rounded p-1.5 mt-1 bg-blue-50 text-blue-900 resize-none outline-none font-mono"
            readOnly
            rows={4}
            value={result}
          />
        </div>
      )}
    </BaseNode>
  );
}
