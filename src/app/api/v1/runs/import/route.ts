import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { performIngestion } from '@/lib/ingest-helper';
import { checkAuth, sendSuccess, sendError } from '@/lib/api-helper';

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return sendError('UNAUTHORIZED', 'Invalid or missing API key', null, 401);
  }

  try {
    const body = await req.json();
    const { benchmark_slug, run_label, agent_name, harness_version, artifact } = body;

    if (!benchmark_slug) {
      return sendError('VALIDATION_ERROR', 'Missing field benchmark_slug', { field: 'benchmark_slug' }, 400);
    }
    if (!run_label) {
      return sendError('VALIDATION_ERROR', 'Missing field run_label', { field: 'run_label' }, 400);
    }
    if (!agent_name) {
      return sendError('VALIDATION_ERROR', 'Missing field agent_name', { field: 'agent_name' }, 400);
    }
    if (!harness_version) {
      return sendError('VALIDATION_ERROR', 'Missing field harness_version', { field: 'harness_version' }, 400);
    }
    if (!artifact || !artifact.uri) {
      return sendError('VALIDATION_ERROR', 'Missing field artifact.uri', { field: 'artifact.uri' }, 400);
    }

    const uri = artifact.uri;
    let filePath = '';
    
    // Resolve S3 or custom URI locally
    if (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('s3://')) {
      // Map to local demo files based on keyword
      if (uri.toLowerCase().includes('improved') || uri.toLowerCase().includes('variant')) {
        filePath = path.join(process.cwd(), 'public/demo/runs/improved.json');
      } else {
        filePath = path.join(process.cwd(), 'public/demo/runs/baseline.json');
      }
    } else {
      // Try local path directly
      filePath = path.isAbsolute(uri) ? uri : path.join(process.cwd(), uri);
    }

    if (!fs.existsSync(filePath)) {
      return sendError('NOT_FOUND', `Run log artifact file not found at path: ${filePath}`, { uri }, 404);
    }

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const demoPayload = JSON.parse(fileContent);

    // Resolve benchmark and check duplicate
    let benchmarkId = 0;
    const bench = await db.prepare('SELECT id FROM benchmarks WHERE slug = ?').get(benchmark_slug) as any;
    if (bench) {
      benchmarkId = bench.id;
      const existing = await db.prepare('SELECT id FROM runs WHERE run_label = ? AND benchmark_id = ?').get(run_label, benchmarkId) as any;
      if (existing) {
        return sendError('DUPLICATE_RUN', 'A run with this label and benchmark already exists.', { existing_run_id: existing.id }, 409);
      }
    }

    // Override demo fields with request inputs
    const run_id = crypto.randomUUID();
    const payload = {
      run_id,
      metadata: {
        benchmark: benchmark_slug === 'terminal_bench_2' ? 'Terminal-Bench 2.0' : benchmark_slug,
        benchmark_slug: benchmark_slug,
        benchmark_description: demoPayload.metadata?.benchmark_description || 'Imported run',
        benchmark_source_url: demoPayload.metadata?.benchmark_source_url || '',
        agent: agent_name,
        harness_version: harness_version,
        run_label: run_label,
        raw_artifact_uri: uri,
        harness_config: demoPayload.metadata?.harness_config || {},
        harness_notes: demoPayload.metadata?.harness_notes || ''
      },
      tasks: demoPayload.tasks || []
    };

    const result = await performIngestion(payload);

    return sendSuccess({
      run_id: result.run_id,
      ingested_tasks: result.ingested_tasks,
      benchmark_slug: benchmark_slug
    }, 201);

  } catch (err: any) {
    console.error('Import Route Error:', err);
    return sendError('SERVER_ERROR', err.message || 'Error importing run', null, 500);
  }
}
