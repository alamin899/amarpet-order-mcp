import { config } from './config.mjs';

const ORDER_URL = `${config.upstreamBaseUrl}/test/orders-by-date`;

let keyIndex = 0;

function getUpstreamKey() {
  const { upstreamApiKeys: keys } = config;
  if (keys.length === 0) return '';
  const key = keys[keyIndex % keys.length];
  keyIndex = (keyIndex + 1) % keys.length;
  return key;
}

function buildHeaders() {
  const headers = {
    accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  };
  const key = getUpstreamKey();
  if (key) headers['x-api-key'] = key;
  return headers;
}

export async function fetchOrders(startDate, endDate) {
  const url = new URL(ORDER_URL);
  url.searchParams.set('start_date', startDate);
  url.searchParams.set('end_date', endDate);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: buildHeaders(),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Upstream ${res.status}: ${text}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}
