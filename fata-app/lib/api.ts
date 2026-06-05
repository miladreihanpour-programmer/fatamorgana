import * as SecureStore from 'expo-secure-store';

// Server URL — Render.com (free, always on)
// After deploying to Render, this will be your permanent URL
export const API_BASE = 'https://fata-morgana-api.onrender.com';

const TOKEN_KEY     = 'fm_token';
const SHOP_NAME_KEY = 'fm_shop_name';
const SHOP_ID_KEY   = 'fm_shop_id';

export const getToken    = () => SecureStore.getItemAsync(TOKEN_KEY);
export const saveToken   = (t: string) => SecureStore.setItemAsync(TOKEN_KEY, t);
export const clearToken  = async () => {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(SHOP_NAME_KEY);
  await SecureStore.deleteItemAsync(SHOP_ID_KEY);
};
export const getShopName = () => SecureStore.getItemAsync(SHOP_NAME_KEY);
export const getShopId   = () => SecureStore.getItemAsync(SHOP_ID_KEY);

async function authHeaders() {
  const token = await getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function req<T>(method: string, path: string, body?: object): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: await authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as any).error ?? 'Errore di rete');
  }
  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function login(username: string, password: string) {
  const data = await req<{ token: string; user: string; shopId: string; shopName: string }>(
    'POST', '/auth/login', { username, password }
  );
  await saveToken(data.token);
  if (data.shopName) await SecureStore.setItemAsync(SHOP_NAME_KEY, data.shopName);
  if (data.shopId)   await SecureStore.setItemAsync(SHOP_ID_KEY,   data.shopId);
  return data;
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type FlavorData = {
  flavor: string; stock: number; sold7d: number; sold30d: number;
  hist: number; rate: number; trend: string; target: number;
  order: number; reason: string;
};

export type InsightsResponse = {
  kpis: {
    totalStock: number; totalSold7d: number; totalSold30d: number;
    totalOrder: number; activeCount: number; outOfStock: number;
    needOrder: number; flavorCount: number;
  };
  data: FlavorData[];
  lastUpdated: string;
  shopName?: string;
};

export type ExtractionStatus = {
  running: boolean; startedAt: string | null;
  progress: string[]; error: string | null;
  lastResult: { ordered: number; totalVas: number; timestamp: string } | null;
};

export type HistoryRow = {
  id: number; ts: string; total_ord: number; total_vas: number; status: string;
};

// ── API calls ─────────────────────────────────────────────────────────────────
export const getInsights         = () => req<InsightsResponse>('GET', '/api/insights');
export const triggerExtraction   = () => req<{ status: string }>('POST', '/api/extract', {});
export const getExtractionStatus = () => req<ExtractionStatus>('GET', '/api/extract/status');
export const getHistory          = () => req<HistoryRow[]>('GET', '/api/history');
export const getVarie            = () => req<Record<string, number>>('GET', '/api/varie');
export const saveVarie           = (quantities: Record<string, number>) =>
  req<{ ok: boolean }>('POST', '/api/varie', { quantities });

export async function getPdfUrl() {
  const token = await getToken();
  return `${API_BASE}/api/orders/pdf?token=${token}`;
}

export async function getInsightsHtmlUrl() {
  const token = await getToken();
  if (!token) throw new Error('Non autenticato');
  return `${API_BASE}/api/insights/html?token=${encodeURIComponent(token)}`;
}

/** Fetch the insights HTML as a string so the WebView can render it via
 *  source={{ html }} — this avoids CDN/mixed-content/CORS blocking in
 *  React Native WebView, which can silently prevent Chart.js from loading
 *  when loaded via a remote URI. */
export async function getInsightsHtml(): Promise<string> {
  const token = await getToken();
  if (!token) throw new Error('Non autenticato');
  const res = await fetch(`${API_BASE}/api/insights/html`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Errore server: ${res.status}`);
  return res.text();
}
