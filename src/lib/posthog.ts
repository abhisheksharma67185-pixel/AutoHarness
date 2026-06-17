import posthog from 'posthog-js';

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com';

if (typeof window !== 'undefined') {
  if (key && process.env.NODE_ENV !== 'development') {
    posthog.init(key, {
      api_host: host,
      capture_pageview: false, // Disable automatic capture so we can control it if needed or use pageview auto-tracking
    });
  } else if (process.env.NODE_ENV === 'development') {
    // In development, we can initialize with debug enabled or opt-out entirely
    if (key) {
      posthog.init(key, {
        api_host: host,
        capture_pageview: false,
        loaded: (ph) => {
          ph.opt_out_capturing(); // Disable capturing in development
        }
      });
    }
  }
}

export { posthog };
