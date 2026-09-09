'use client';

import { useEffect, useState } from 'react';

// Every view polls the shared server state so transactions propagate
// across tabs without a websocket layer — good enough for a demo.
export function usePolledState(intervalMs = 1500) {
  const [state, setState] = useState(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const res = await fetch('/api/state', { cache: 'no-store' });
        if (res.ok && alive) setState(await res.json());
      } catch {
        // dev server hiccup — next poll will recover
      }
    }
    tick();
    const t = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [intervalMs]);

  return state;
}

export async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}
