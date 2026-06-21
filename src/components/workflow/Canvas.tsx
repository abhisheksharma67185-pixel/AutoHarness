'use client';

import React, { useEffect, useRef } from 'react';
import ReactFlow, {
  type Node,
  type Edge,
  MiniMap,
  Controls,
  Background,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
  MarkerType,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { InputNode } from './nodes/InputNode';
import { OutputNode } from './nodes/OutputNode';
import { LLMNode } from './nodes/LLMNode';
import { TextNode } from './nodes/TextNode';
import { LogicNode } from './nodes/LogicNode';
import { HTTPNode } from './nodes/HTTPNode';
import { DatabaseNode } from './nodes/DatabaseNode';
import { ApprovalNode } from './nodes/ApprovalNode';
import { type BaseNodeData } from './nodes/BaseNode';
import { posthog } from '@/lib/posthog';
import type { NodeEventProps } from '@/lib/posthog';

const nodeTypes: NodeTypes = {
  input: InputNode,
  output: OutputNode,
  llm: LLMNode,
  text: TextNode,
  logic: LogicNode,
  http: HTTPNode,
  database: DatabaseNode,
  approval: ApprovalNode,
};

const edgeTypes = {};

export interface WorkflowCanvasProps {
  initialNodes?: Node<BaseNodeData>[];
  initialEdges?: Edge[];
  onNodesChange?: (changes: NodeChange[]) => void;
  onEdgesChange?: (changes: EdgeChange[]) => void;
  onConnect?: (connection: Connection) => void;
  onSelectionChange?: (params: { nodes: Node[]; edges: Edge[] }) => void;
  className?: string;
}

export function WorkflowCanvas({
  initialNodes = [],
  initialEdges = [],
  onNodesChange,
  onEdgesChange,
  onConnect,
  onSelectionChange,
  className,
}: WorkflowCanvasProps) {
  const [nodes, setNodes, onNodesChangeInternal] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState(initialEdges);



  // Sync state with parent props when they change
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  // Track when an approval node is added to the canvas
  const prevApprovalCount = useRef(0);
  useEffect(() => {
    const approvalCount = initialNodes.filter((n) => n.type === 'approval').length;
    if (approvalCount > prevApprovalCount.current) {
      const nodeProps: NodeEventProps = { node_type: 'approval' };
      posthog.capture('approval_node_added', nodeProps);
    }
    prevApprovalCount.current = approvalCount;
  }, [initialNodes]);

  const handleNodesChange = (changes: NodeChange[]) => {
    if (onNodesChange) {
      onNodesChange(changes);
    } else {
      onNodesChangeInternal(changes);
    }
  };

  const handleEdgesChange = (changes: EdgeChange[]) => {
    if (onEdgesChange) {
      onEdgesChange(changes);
    } else {
      onEdgesChangeInternal(changes);
    }
  };

  const handleConnect = (connection: Connection) => {
    if (onConnect) {
      onConnect(connection);
    } else {
      setEdges((eds) =>
        eds.concat({
          id: `edge-${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}`,
          source: connection.source!,
          target: connection.target!,
          sourceHandle: connection.sourceHandle || undefined,
          targetHandle: connection.targetHandle || undefined,
          type: 'smoothstep',
        })
      );
    }
  };

  const handleSelectionChange = (params: { nodes: Node[]; edges: Edge[] }) => {
    if (onSelectionChange) {
      onSelectionChange(params);
    }
  };

  return (
    <div className={`w-full h-full ${className}`} style={{ width: '100%', height: '100%', minHeight: '600px' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onSelectionChange={handleSelectionChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        edgesFocusable={true}
        nodesDraggable={true}
        nodesConnectable={true}
        connectOnClick={true}
        fitView
        fitViewOptions={{
          padding: 0.2,
        }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: false,
          markerEnd: {
            type: MarkerType.Arrow,
            color: '#9ca3af',
          },
        }}
      >
        <Background color="#e5e7eb" gap={16} size={2} />
        <MiniMap />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export function WorkflowCanvasWrapper({ children }: { children: React.ReactNode }) {
  return <ReactFlowProvider>{children}</ReactFlowProvider>;
}
