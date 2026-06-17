'use client';

import { useCallback, useRef, useState } from 'react';
import { Node, Edge } from 'reactflow';
import { BaseNodeData } from '../components/workflow/nodes/BaseNode';

export interface ExecutionLog {
  step: number;
  nodeId: string;
  nodeType: string;
  message: string;
  timestamp: number;
}

export interface ExecutionResult {
  success: boolean;
  output?: string;
  logs: ExecutionLog[];
  error?: string;
  paused?: boolean;
  approvalId?: string;
  approvalTitle?: string;
  approvalDescription?: string;
}

export interface ApprovalItem {
  id: string;
  title: string;
  description: string;
  requestedBy: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionNote?: string;
  approvedBy?: string;
  approvedAt?: string;
  fallbackAction?: string;
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type QueryType = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

interface HttpNodeResponse {
  status: number;
  body: JsonValue;
}

interface DatabaseNodeResponse {
  success: boolean;
  rows: Array<Record<string, JsonValue>>;
  rows_affected: number;
}

function parseJsonObject(value: string, fieldName: string): Record<string, JsonValue> {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object`);
  }
  return parsed as Record<string, JsonValue>;
}

function parseStringMap(value: string, fieldName: string): Record<string, string> {
  const parsed = parseJsonObject(value, fieldName);
  const mapped: Record<string, string> = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (typeof entry !== 'string') {
      throw new Error(`${fieldName} values must be strings`);
    }
    mapped[key] = entry;
  }
  return mapped;
}

function parseOptionalJson(value: string): JsonValue {
  if (!value.trim()) return null;
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return value;
  }
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === 'string') return detail;
  }
  return fallback;
}

function topologicalSort(nodes: Node<BaseNodeData>[], edges: Edge[]): Node<BaseNodeData>[] {
  const inDegree: Record<string, number> = {};
  const adjList: Record<string, string[]> = {};
  nodes.forEach((n) => { inDegree[n.id] = 0; adjList[n.id] = []; });
  edges.forEach((e) => {
    inDegree[e.target] = (inDegree[e.target] || 0) + 1;
    adjList[e.source].push(e.target);
  });
  const queue: string[] = [];
  Object.keys(inDegree).forEach((id) => { if (inDegree[id] === 0) queue.push(id); });
  const sorted: string[] = [];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    sorted.push(currentId);
    adjList[currentId].forEach((neighborId) => {
      inDegree[neighborId]--;
      if (inDegree[neighborId] === 0) queue.push(neighborId);
    });
  }
  return sorted.map((id) => nodes.find((n) => n.id === id)!);
}

export function usePipelineExecution() {
  const [isExecuting, setIsExecuting] = useState(false);
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [pendingApproval, setPendingApproval] = useState<ApprovalItem | null>(null);

  const pausedStateRef = useRef<{
    nodes: Node<BaseNodeData>[];
    edges: Edge[];
    sortedNodes: Node<BaseNodeData>[];
    currentIndex: number;
    nodeOutputs: Record<string, unknown>;
    executionLogs: ExecutionLog[];
    stepCount: number;
  } | null>(null);

  const getInputsForNode = (
    nodeId: string,
    edges: Edge[],
    nodeOutputs: Record<string, unknown>,
  ): Record<string, unknown> => {
    const incomingEdges = edges.filter((e) => e.target === nodeId);
    const inputs: Record<string, unknown> = {};
    incomingEdges.forEach((e) => {
      const sourceOutput = nodeOutputs[e.source];
      if (e.targetHandle && e.targetHandle.startsWith('var:')) {
        const varName = e.targetHandle.replace('var:', '');
        inputs[varName] = sourceOutput;
      } else {
        if (!inputs['default']) inputs['default'] = [] as unknown[];
        (inputs['default'] as unknown[]).push(sourceOutput);
      }
    });
    return inputs;
  };

  const runNodes = useCallback(async (
    nodes: Node<BaseNodeData>[],
    edges: Edge[],
    sortedNodes: Node<BaseNodeData>[],
    startIndex: number,
    nodeOutputs: Record<string, unknown>,
    executionLogs: ExecutionLog[],
    stepCount: number,
  ): Promise<ExecutionResult> => {
    const addLog = (nodeId: string, nodeType: string, message: string) => {
      executionLogs.push({ step: stepCount++, nodeId, nodeType, message, timestamp: Date.now() });
      setLogs([...executionLogs]);
    };

    for (let i = startIndex; i < sortedNodes.length; i++) {
      const node = sortedNodes[i];
      const inputs = getInputsForNode(node.id, edges, nodeOutputs);
      let nodeOutput: unknown = null;

      switch (node.type) {
        case 'input':
          nodeOutput = node.data.params?.inputValue || 'hello';
          addLog(node.id, 'Input', `value: '${nodeOutput}'`);
          break;

        case 'text': {
          let textContent = (node.data.params?.text as string) || '';
          Object.entries(inputs).forEach(([key, value]) => {
            const valStr = Array.isArray(value) ? value.join(', ') : String(value || '');
            textContent = textContent.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), valStr);
          });
          nodeOutput = textContent;
          node.data.params = { ...node.data.params, resolvedText: textContent };
          addLog(node.id, 'Text', `output: '${String(nodeOutput).substring(0, 50)}${String(nodeOutput).length > 50 ? '...' : ''}'`);
          break;
        }

        case 'llm': {
          let prompt = '';
          if (inputs['default'] && Array.isArray(inputs['default']) && inputs['default'].length > 0) {
            prompt = inputs['default'].join('\n');
          } else {
            prompt = (node.data.params?.prompt as string) || '';
          }
          node.data.params = { ...node.data.params, resolvedPrompt: prompt };
          const model = (node.data.params?.model as string) || 'llama3.1:8b';
          const temperature = (node.data.params?.temperature as number) ?? 0.7;
          addLog(node.id, 'LLM', `Calling ${model} with prompt: '${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}'`);

          const res = await fetch('/api/v1/ollama/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt, temperature }),
          });
          if (!res.ok) {
            const errData = await res.json();
            throw new Error(`LLM failed: ${errData.detail?.message || errData.detail || res.statusText}`);
          }
          const data = await res.json();
          nodeOutput = data.response;
          node.data.params = { ...node.data.params, result: nodeOutput };
          addLog(node.id, 'LLM', `response: '${String(nodeOutput).substring(0, 50)}${String(nodeOutput).length > 50 ? '...' : ''}'`);
          break;
        }

        case 'logic':
          nodeOutput = true;
          addLog(node.id, 'Logic', `evaluated to: ${nodeOutput}`);
          break;

        case 'http': {
          const method = ((node.data.params?.method as string) || 'GET').toUpperCase() as HttpMethod;
          const url = (node.data.params?.url as string) || '';
          const headersStr = (node.data.params?.headers as string) || '{}';
          const bodyStr = (node.data.params?.body as string) || '';
          if (!url) throw new Error("HTTP node requires a URL");
          const headers = parseStringMap(headersStr, 'HTTP node headers');
          const requestBody = method === 'POST' || method === 'PUT' ? parseOptionalJson(bodyStr) : null;
          addLog(node.id, 'HTTP', `Calling ${method} ${url}`);

          const httpRes = await fetch('/api/v1/http/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, method, headers, body: requestBody }),
          });
          const httpData = (await httpRes.json().catch(() => null)) as HttpNodeResponse | null;
          if (!httpRes.ok || !httpData) {
            throw new Error(getErrorMessage(httpData, `HTTP request failed: ${httpRes.statusText}`));
          }
          nodeOutput = httpData;
          node.data.params = { ...node.data.params, result: JSON.stringify(nodeOutput) };
          addLog(node.id, 'HTTP', `Status: ${httpData.status}`);
          break;
        }

        case 'database': {
          const queryType = (((node.data.params?.queryType as string) || 'SELECT').toUpperCase()) as QueryType;
          const tableName = (node.data.params?.tableName as string) || '';
          const query = (node.data.params?.query as string) || '';
          const dbParamsStr = (node.data.params?.dbParams as string) || '{}';
          if (!tableName) throw new Error("Database node requires a table name");
          if (!query) throw new Error("Database node requires a SQL query");
          const dbParams = parseJsonObject(dbParamsStr, 'Database node parameters');
          addLog(node.id, 'Database', `Executing ${queryType} on ${tableName}`);

          const dbRes = await fetch('/api/v1/database/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, params: dbParams, query_type: queryType, table_name: tableName }),
          });
          const dbData = (await dbRes.json().catch(() => null)) as DatabaseNodeResponse | null;
          if (!dbRes.ok) {
            throw new Error(getErrorMessage(dbData, `Database query failed: ${dbRes.statusText}`));
          }
          nodeOutput = dbData?.rows || [];
          node.data.params = { ...node.data.params, result: JSON.stringify(nodeOutput) };
          addLog(node.id, 'Database', `Returned ${dbData?.rows.length || 0} rows`);
          break;
        }

        case 'approval': {
          const title = (node.data.params?.title as string) || 'Approval Required';
          const description = (node.data.params?.description as string) || 'Approve this step to continue.';
          const fallbackAction = (node.data.params?.fallbackAction as string) || '';
          addLog(node.id, 'Approval', `Paused: ${title}`);

          const now = new Date().toISOString();
          const approvalItem: ApprovalItem = {
            id: `approval-${Date.now()}`,
            title,
            description,
            requestedBy: 'operator',
            requestedAt: now,
            status: 'pending',
            fallbackAction: fallbackAction || undefined,
          };

          setPendingApproval(approvalItem);
          nodeOutput = { approval_id: approvalItem.id, status: 'paused' };
          nodeOutputs[node.id] = nodeOutput;

          pausedStateRef.current = {
            nodes, edges, sortedNodes,
            currentIndex: i,
            nodeOutputs: { ...nodeOutputs },
            executionLogs: [...executionLogs],
            stepCount,
          };

          setIsExecuting(false);

          return {
            success: true,
            paused: true,
            logs: executionLogs,
            approvalId: approvalItem.id,
            approvalTitle: title,
            approvalDescription: description,
          };
        }

        case 'output': {
          if (inputs['default'] && Array.isArray(inputs['default']) && inputs['default'].length > 0) {
            nodeOutput = inputs['default'].join('\n---\n');
          } else {
            nodeOutput = 'No inputs connected';
          }
          addLog(node.id, 'Output', `final result: '${String(nodeOutput).substring(0, 50)}${String(nodeOutput).length > 50 ? '...' : ''}'`);
          break;
        }

        default:
          addLog(node.id, node.type || 'Unknown', `Node executed`);
          break;
      }

      nodeOutputs[node.id] = nodeOutput;
    }

    const outputNodes = sortedNodes.filter((n) => n.type === 'output');
    const finalOutput = outputNodes.length > 0
      ? String(nodeOutputs[outputNodes[outputNodes.length - 1].id] || '')
      : '';

    return { success: true, output: finalOutput, logs: executionLogs };
  }, []);

  const executePipeline = useCallback(async (
    nodes: Node<BaseNodeData>[],
    edges: Edge[],
  ): Promise<ExecutionResult> => {
    setIsExecuting(true);
    setPendingApproval(null);
    const executionLogs: ExecutionLog[] = [];
    let stepCount = 1;

    try {
      const sortedNodes = topologicalSort(nodes, edges);
      if (sortedNodes.length !== nodes.length) {
        throw new Error("Cycle detected in pipeline. Cannot execute.");
      }
      return await runNodes(nodes, edges, sortedNodes, 0, {}, executionLogs, stepCount);
    } catch (err: unknown) {
      setIsExecuting(false);
      const errorMsg = err instanceof Error ? err.message : 'Execution failed';
      executionLogs.push({ step: stepCount++, nodeId: 'system', nodeType: 'System', message: `Error: ${errorMsg}`, timestamp: Date.now() });
      return { success: false, logs: executionLogs, error: errorMsg };
    }
  }, [runNodes]);

  const resumePipeline = useCallback(async (): Promise<ExecutionResult | null> => {
    const state = pausedStateRef.current;
    if (!state) return null;

    setPendingApproval(null);
    setIsExecuting(true);

    try {
      const result = await runNodes(
        state.nodes, state.edges, state.sortedNodes,
        state.currentIndex + 1, state.nodeOutputs,
        state.executionLogs, state.stepCount,
      );
      setIsExecuting(false);
      pausedStateRef.current = null;
      return result;
    } catch (err: unknown) {
      setIsExecuting(false);
      pausedStateRef.current = null;
      const errorMsg = err instanceof Error ? err.message : 'Execution failed';
      return { success: false, logs: state.executionLogs, error: errorMsg };
    }
  }, [runNodes]);

  const rejectApproval = useCallback((rejectionNote?: string) => {
    const current = pendingApproval;
    if (current) {
      setPendingApproval({ ...current, status: 'rejected', rejectionNote });
    }
    pausedStateRef.current = null;
    setIsExecuting(false);
  }, [pendingApproval]);

  return {
    executePipeline,
    resumePipeline,
    rejectApproval,
    isExecuting,
    logs,
    pendingApproval,
  };
}
