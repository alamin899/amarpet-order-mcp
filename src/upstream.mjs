import { config } from './config.mjs';

const ORDER_URL = `${config.upstreamBaseUrl}/test/orders-by-date`;

// ─── KEY ROTATION ─────────────────────────────────────────────
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

// ─── COMPRESS MAPS ────────────────────────────────────────────
const STATUS_MAP = {
  ORDER_PLACED: 'placed',
  PROCESSING:   'processing',
  DELIVERED:    'delivered',
  CANCELLED:    'cancelled',
  RETURNED:     'returned',
};

const SOURCE_MAP = {
  WEBSITE:    'web',
  MOBILE_APP: 'app',
  FACEBOOK:   'fb',
};

const PAY_MAP = {
  '1': 'cod',
  '2': 'online',
  '3': 'card',
};

const FIN_MAP = {
  '1': 'unpaid',
  '2': 'partial',
  '3': 'paid',
};

// ─── COMPRESS SINGLE ORDER ────────────────────────────────────
function compressOrder(o) {
  const obj = {
    id:     o.id,
    track:  o.tracking_number,
    time:   o.order_datetime.slice(11, 16),
    status: STATUS_MAP[o.order_status]  ?? o.order_status,
    src:    SOURCE_MAP[o.order_source]  ?? o.order_source,
    name:   o.customer_name.trim(),
    cid:    o.customer_id,
    qty:    Math.round(parseFloat(o.total_quantity_purchased)),
    price:  parseFloat(parseFloat(o.total_order_products_price).toFixed(2)),
    ship:   parseFloat(o.shipping_cost),
    total:  parseFloat(o.total),
    profit: parseFloat(o.profit),
    pay:    PAY_MAP[o.payment_method]   ?? o.payment_method,
    fin:    FIN_MAP[o.financial_status] ?? o.financial_status,
  };

  // Only include if non-zero
  const disc   = parseFloat(o.discount);
  const coupon = parseFloat(o.coupon_discount);
  if (disc   > 0) obj.disc   = disc;
  if (coupon > 0) obj.coupon = coupon;

  // Only include if non-null / non-zero
  if (o.admin_discount)                       obj.admin_disc = o.admin_discount;
  if (parseFloat(o.admin_shipping_cost) > 0)  obj.admin_ship = parseFloat(o.admin_shipping_cost);

  return obj;
}

// ─── BUILD SUMMARY ────────────────────────────────────────────
function buildSummary(orders) {
  const totalRevenue = orders.reduce((s, o) => s + o.total,  0);
  const totalProfit  = orders.reduce((s, o) => s + o.profit, 0);
  const totalQty     = orders.reduce((s, o) => s + o.qty,    0);

  const byStatus = {};
  const bySrc    = {};
  const byPay    = {};
  const byFin    = {};

  for (const o of orders) {
    byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    bySrc[o.src]       = (bySrc[o.src]       ?? 0) + 1;
    byPay[o.pay]       = (byPay[o.pay]       ?? 0) + 1;
    byFin[o.fin]       = (byFin[o.fin]       ?? 0) + 1;
  }

  return {
    count:     orders.length,
    revenue:   parseFloat(totalRevenue.toFixed(2)),
    profit:    parseFloat(totalProfit.toFixed(2)),
    qty:       totalQty,
    margin:    totalRevenue > 0
                 ? parseFloat(((totalProfit / totalRevenue) * 100).toFixed(1))
                 : 0,
    by_status: byStatus,
    by_src:    bySrc,
    by_pay:    byPay,
    by_fin:    byFin,
  };
}

// ─── MAIN FETCH ───────────────────────────────────────────────
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

    const raw = JSON.parse(text);
    const orders = (raw.data ?? []).map(compressOrder);

    return {
      summary: buildSummary(orders),
      orders,
    };

  } finally {
    clearTimeout(timer);
  }
}