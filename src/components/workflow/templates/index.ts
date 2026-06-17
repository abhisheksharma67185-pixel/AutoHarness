import { Node, Edge } from 'reactflow';
import { BaseNodeData } from '../nodes/BaseNode';

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  nodes: Node<BaseNodeData>[];
  edges: Edge[];
}

export const emailSummarizer: WorkflowTemplate = {
  id: 'email-summarizer',
  name: 'Email Summarizer',
  description: 'Summarize a long email into key points using an LLM',
  nodes: [
    {
      id: 'tpl-input-1',
      type: 'input',
      position: { x: 50, y: 150 },
      data: {
        label: 'Email Input',
        kind: 'input',
        description: 'Paste the email text here',
        params: { inputValue: 'Dear team, please find attached the quarterly report. Revenue grew 23% QoQ...' },
      },
    },
    {
      id: 'tpl-llm-1',
      type: 'llm',
      position: { x: 400, y: 150 },
      data: {
        label: 'Summarizer',
        kind: 'llm',
        description: 'Calls Ollama via proxy to summarize',
        params: {
          model: 'llama3.1:8b',
          temperature: 0.3,
          prompt: 'Summarize the following email into 3-5 bullet points covering the key information:\n\n{{ email }}',
        },
      },
    },
    {
      id: 'tpl-output-1',
      type: 'output',
      position: { x: 750, y: 150 },
      data: {
        label: 'Summary',
        kind: 'output',
        description: 'Displays the generated summary',
        params: {},
      },
    },
  ],
  edges: [
    {
      id: 'tpl-e1-2',
      source: 'tpl-input-1',
      target: 'tpl-llm-1',
      targetHandle: 'var:email',
      type: 'smoothstep',
    },
    {
      id: 'tpl-e2-3',
      source: 'tpl-llm-1',
      target: 'tpl-output-1',
      type: 'smoothstep',
    },
  ],
};

export const dataExtractor: WorkflowTemplate = {
  id: 'data-extractor',
  name: 'Data Extractor',
  description: 'Extract structured fields from raw text using Text + LLM',
  nodes: [
    {
      id: 'tpl-input-2',
      type: 'input',
      position: { x: 50, y: 150 },
      data: {
        label: 'Raw Input',
        kind: 'input',
        description: 'Enter unstructured text',
        params: { inputValue: 'John Doe, johndoe@email.com, last login: 2026-06-15' },
      },
    },
    {
      id: 'tpl-text-2',
      type: 'text',
      position: { x: 300, y: 150 },
      data: {
        label: 'Format Instructions',
        kind: 'text',
        description: 'Prepares the extraction prompt',
        params: { text: 'Extract the following fields from this text: name, email, and last login date.\n\n---\n{{ raw_text }}\n---\n\nReturn the result as a JSON object.' },
      },
    },
    {
      id: 'tpl-llm-2',
      type: 'llm',
      position: { x: 600, y: 150 },
      data: {
        label: 'Extractor LLM',
        kind: 'llm',
        description: 'Extracts structured data via Ollama',
        params: {
          model: 'llama3.1:8b',
          temperature: 0.2,
        },
      },
    },
    {
      id: 'tpl-output-2',
      type: 'output',
      position: { x: 900, y: 150 },
      data: {
        label: 'Extracted Data',
        kind: 'output',
        description: 'Displays the structured result',
        params: {},
      },
    },
  ],
  edges: [
    {
      id: 'tpl-e2-1-2',
      source: 'tpl-input-2',
      target: 'tpl-text-2',
      targetHandle: 'var:raw_text',
      type: 'smoothstep',
    },
    {
      id: 'tpl-e2-2-3',
      source: 'tpl-text-2',
      target: 'tpl-llm-2',
      type: 'smoothstep',
    },
    {
      id: 'tpl-e2-3-4',
      source: 'tpl-llm-2',
      target: 'tpl-output-2',
      type: 'smoothstep',
    },
  ],
};

export const chatbot: WorkflowTemplate = {
  id: 'chatbot',
  name: 'Chatbot',
  description: 'A simple chatbot pipeline that responds to user messages',
  nodes: [
    {
      id: 'tpl-input-3',
      type: 'input',
      position: { x: 50, y: 150 },
      data: {
        label: 'User Message',
        kind: 'input',
        description: 'Type your message here',
        params: { inputValue: 'What is the capital of France?' },
      },
    },
    {
      id: 'tpl-llm-3',
      type: 'llm',
      position: { x: 400, y: 150 },
      data: {
        label: 'Chat LLM',
        kind: 'llm',
        description: 'Responds via Ollama',
        params: {
          model: 'llama3.1:8b',
          temperature: 0.7,
          prompt: 'You are a helpful assistant. Answer concisely:\n\n{{ message }}',
        },
      },
    },
    {
      id: 'tpl-output-3',
      type: 'output',
      position: { x: 750, y: 150 },
      data: {
        label: 'Response',
        kind: 'output',
        description: 'Displays the assistant response',
        params: {},
      },
    },
  ],
  edges: [
    {
      id: 'tpl-e3-1-2',
      source: 'tpl-input-3',
      target: 'tpl-llm-3',
      targetHandle: 'var:message',
      type: 'smoothstep',
    },
    {
      id: 'tpl-e3-2-3',
      source: 'tpl-llm-3',
      target: 'tpl-output-3',
      type: 'smoothstep',
    },
  ],
};

export const allTemplates: WorkflowTemplate[] = [
  emailSummarizer,
  dataExtractor,
  chatbot,
];
