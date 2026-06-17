'use client';

import React, { useMemo } from 'react';
import { Handle, Position } from 'reactflow';
import { BaseNode, type BaseNodeData } from './BaseNode';
import { useVariableParser } from '../../../hooks/useVariableParser';

interface TextNodeProps {
  data: BaseNodeData & {
    text?: string;
  };
}

export function TextNode({ data }: TextNodeProps) {
  const textContent = (data.params?.text as string) || data.text || '';
  const resolvedContent = (data.params?.resolvedText as string) || textContent;
  const variables = useVariableParser(textContent);

  const parsedElements = useMemo(() => {
    if (!resolvedContent) return null;
    // If it's already resolved (no variables left), just show it
    if (!resolvedContent.includes('{{')) {
      return <span>{resolvedContent}</span>;
    }
    
    return resolvedContent.split(/({{[^}]+}})/).map((part, idx) => {
      if (part.startsWith('{{') && part.endsWith('}}')) {
        const varName = part.replace(/{{\s*|\s*}}/g, '').trim();
        return (
          <span key={idx} className="text-orange-700 bg-orange-100 px-1 py-0.5 rounded font-bold mx-0.5">
            {varName}
          </span>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  }, [resolvedContent]);

  return (
    <BaseNode data={data}>
      {textContent && (
        <div className="mt-2">
          <div className="text-xs text-gray-700 bg-gray-50 p-2 rounded border border-gray-200 font-mono whitespace-pre-wrap">
            {parsedElements}
          </div>
          
          {variables.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] uppercase tracking-wider font-bold text-gray-400 mb-1">
                Variables
              </div>
              <div className="space-y-1">
                {variables.map((v, i) => (
                  <div key={v} className="flex items-center text-xs bg-gray-100 px-2 py-1 rounded relative">
                    <span className="text-gray-600 font-mono truncate">{v}</span>
                    {/* Dynamic Target Handle for this variable */}
                    <Handle
                      type="target"
                      position={Position.Left}
                      id={`var:${v}`}
                      className="w-2.5 h-2.5 bg-orange-400 border-2 border-white absolute -left-3"
                      style={{ top: '50%', transform: 'translateY(-50%)' }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </BaseNode>
  );
}
