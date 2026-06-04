import * as SecureStore from 'expo-secure-store';

// ⚠️  Change this to your server IP when testing on a real phone
// Your PC's local IP is 192.168.1.98
export const API_BASE = 'http://192.168.1.91:3001';

const TOKEN_KEY = 'fm_token';

export const getToken   = () => SecureStore.getItemAsync(TOKEN_KEY);
export const saveToken  = (t: string) => SecureStore.setItemAsync(TOKEN_KEY, t);
export const clearToken = () => SecureStore.deleteItemAsync(TOKEN_KEY);

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
  const data = await req<{ token: string; user: string }>('POST', '/auth/login', { username, password });
  await saveToken(data.token);
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
export const getInsights        = () => req<InsightsResponse>('GET', '/api/insights');
export const triggerExtraction  = () => req<{ status: string }>('POST', '/api/extract', {});
export const getExtractionStatus= () => req<ExtractionStatus>('GET', '/api/extract/status');
export const getHistory         = () => req<HistoryRow[]>('GET', '/api/history');

export async function getPdfUrl() {
  const token = await getToken();
  return `${API_BASE}/api/orders/pdf?token=${token}`;
}

export async function getInsightsHtmlUrl() {
  const token = await getToken();
  return `${API_BASE}/api/insights/html?token=${token}`;
}
