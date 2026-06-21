import posthog from 'posthog-js';

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com';

if (typeof window !== 'undefined') {
  const isPlaceholder = !key || key === 'your_posthog_project_api_key' || key.includes('dummy');
  
  if (!isPlaceholder && process.env.NODE_ENV !== 'development') {
    posthog.init(key, {
      api_host: host,
      capture_pageview: false,
    });
  } else if (process.env.NODE_ENV === 'development') {
    if (!isPlaceholder) {
      posthog.init(key, {
        api_host: host,
        capture_pageview: false,
        loaded: (ph) => {
          ph.opt_out_capturing();
        },
      });
    }
  }
}

// ─── Typed event property shapes ────────────────────────────────────────────

export type ApprovalEventSource = 'sidebar' | 'panel' | 'canvas';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/** Attached to every approval-related event. */
export interface ApprovalEventProps {
  run_id: string;
  workflow_id: string;
  node_id: string;
  node_title: string;
  approval_status: ApprovalStatus;
  event_source: ApprovalEventSource;
}

/** Additional fields for events that record the decision latency. */
export interface TimeBasedEventProps extends ApprovalEventProps {
  requested_at: string;       // ISO timestamp
  time_to_approval_ms: number; // ms from requested_at to decision
}

/** Properties sent with audit export events. */
export interface ExportEventProps {
  format: 'json' | 'csv';
  run_id: string;
  entry_count: number;
}

/** Properties sent when a node is added to the canvas. */
export interface NodeEventProps {
  node_type: string;
}

/** Properties sent when a workflow run starts or completes. */
export interface RunEventProps {
  run_id: string;
  workflow_id: string;
}

export { posthog };
