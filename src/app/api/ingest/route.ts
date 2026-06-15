import { NextRequest, NextResponse } from 'next/server';
import { IngestionPayload } from '@/lib/types';
import { performIngestion } from '@/lib/ingest-helper';

export async function POST(req: NextRequest) {
  try {
    const payload: IngestionPayload = await req.json();
    const result = await performIngestion(payload);

    return NextResponse.json({
      success: true,
      run_id: result.run_id,
      message: 'Run successfully ingested under logical schema requirements.'
    });

  } catch (err: any) {
    console.error('Ingestion API Error:', err);
    return NextResponse.json(
      { error: err.message || 'An error occurred during ingestion.' },
      { status: 500 }
    );
  }
}
