import { useCallback, useEffect, useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator, Image, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BarChart } from 'react-native-gifted-charts';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { getInsights, getShopName, clearToken, type InsightsResponse } from '../../lib/api';
import { C } from '../../lib/theme';

/* ── Pill label ──────────────────────────────────────────────────────────────*/
function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={[p.wrap, { borderColor: color + '40', backgroundColor: color + '14' }]}>
      <Text style={[p.txt, { color }]}>{label}</Text>
    </View>
  );
}
const p = StyleSheet.create({
  wrap: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  txt:  { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
});

/* ── Stat card ───────────────────────────────────────────────────────────────*/
function StatCard({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  return (
    <View style={[sc.card, { borderTopColor: accent, borderTopWidth: 1.5 }]}>
      <Text style={[sc.val, { color: accent }]}>{value}</Text>
      <Text style={sc.lbl}>{label}</Text>
    </View>
  );
}
const sc = StyleSheet.create({
  card: { flex: 1, backgroundColor: C.s2, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.glassBdr, shadowColor: C.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, elevation: 4 },
  val:  { fontSize: 28, fontWeight: '800' },
  lbl:  { color: C.textSub, fontSize: 11, marginTop: 4, fontWeight: '500' },
});

/* ── Screen ──────────────────────────────────────────────────────────────────*/
export default function DashboardScreen() {
  const router = useRouter();
  const [data,       setData]       = useState<InsightsResponse | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [shopName,   setShopName]   = useState<string | null>(null);

  useEffect(() => { getShopName().then(setShopName); }, []);

  function handleLogout() {
    Alert.alert('Esci', 'Vuoi disconnetterti?', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Esci', style: 'destructive', onPress: async () => {
        await clearToken();
        router.replace('/login');
      }},
    ]);
  }

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try   { setData(await getInsights()); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <View style={[s.fill, { backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }]}>
      <ActivityIndicator size="large" color={C.amber} />
    </View>
  );

  if (error) return (
    <View style={[s.fill, { backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32 }]}>
      <Text style={{ color: C.terra, textAlign: 'center', marginBottom: 20 }}>{error}</Text>
      <TouchableOpacity onPress={() => load()}>
        <LinearGradient colors={C.gradAmber} style={{ borderRadius: 10, paddingHorizontal: 28, paddingVertical: 12 }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Riprova</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );

  const { kpis, data: flavors, lastUpdated } = data!;
  const top8 = [...flavors].filter(f => f.sold7d > 0).sort((a, b) => b.sold7d - a.sold7d).slice(0, 8);
  const barData = top8.map(f => ({
    value: f.sold7d,
    label: f.flavor.length > 10 ? f.flavor.slice(0, 9) + '…' : f.flavor,
    frontColor: C.amber,
    gradientColor: C.amberDk,
  }));
  const atRisk = flavors.filter(f => f.stock <= f.sold7d && f.sold7d > 0).slice(0, 6);
  const updated = new Date(lastUpdated).toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  return (
    <View style={s.fill}>
      <ScrollView
        style={{ backgroundColor: C.bg }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(true); }}
            tintColor={C.amber} />
        }
      >
        {/* Header */}
        <View style={s.header}>
          <Image
            source={require('../../assets/logo.png')}
            style={s.logo}
            resizeMode="contain"
          />
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Pill label="● live" color={C.sageLt} />
              <TouchableOpacity onPress={handleLogout} hitSlop={10}>
                <Ionicons name="log-out-outline" size={20} color={C.muted} />
              </TouchableOpacity>
            </View>
            {shopName && <Text style={s.shopName}>{shopName}</Text>}
            <Text style={s.headerSub}>Aggiornato {updated}</Text>
          </View>
        </View>

        <View style={s.body}>

          {/* Hero card — most important number */}
          <LinearGradient colors={['#E07B1A', '#B85C08']} style={s.heroCard}>
            <Text style={s.heroLabel}>VASCHETTE DA ORDINARE</Text>
            <Text style={s.heroVal}>{kpis.totalOrder}</Text>
            <View style={s.heroRow}>
              {[
                { n: kpis.needOrder,   l: 'gusti' },
                { n: kpis.activeCount, l: 'attivi' },
                { n: kpis.outOfStock,  l: 'esauriti' },
              ].map((item, i, arr) => (
                <View key={i} style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={s.heroStatN}>{item.n}</Text>
                    <Text style={s.heroStatL}>{item.l}</Text>
                  </View>
                  {i < arr.length - 1 && <View style={s.heroDiv} />}
                </View>
              ))}
            </View>
          </LinearGradient>

          {/* 4 KPI cards — 2×2 grid */}
          <View style={s.statGrid}>
            <StatCard label="In magazzino"    value={kpis.totalStock}   accent={C.amber} />
            <StatCard label="Venduti 7gg"     value={kpis.totalSold7d}  accent={C.sageLt} />
          </View>
          <View style={[s.statGrid, { marginTop: 10 }]}>
            <StatCard label="Venduti 30gg"    value={kpis.totalSold30d} accent={C.sageLt} />
            <StatCard label="Gusti attivi"    value={kpis.activeCount}  accent={C.textSub} />
          </View>

          {/* Chart */}
          {barData.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>TOP VENDUTI — SETTIMANA</Text>
              <View style={s.chartCard}>
                <BarChart
                  data={barData}
                  barWidth={22}
                  spacing={14}
                  roundedTop
                  hideRules
                  xAxisThickness={0}
                  yAxisThickness={0}
                  yAxisTextStyle={{ color: C.muted, fontSize: 10 }}
                  xAxisLabelTextStyle={{ color: C.textSub, fontSize: 8, width: 44, textAlign: 'center' }}
                  gradientColor={C.amberGlow}
                  noOfSections={4}
                  height={160}
                  isAnimated
                />
              </View>
            </View>
          )}

          {/* At-risk flavors */}
          {atRisk.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>A RISCHIO ESAURIMENTO</Text>
              {atRisk.map(f => {
                const color = f.trend.includes('↑') ? C.sageLt
                            : f.trend.includes('↓') ? C.terra : C.textSub;
                return (
                  <View key={f.flavor} style={s.riskRow}>
                    <View style={[s.riskLine, { backgroundColor: color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.riskName}>{f.flavor}</Text>
                      <Text style={s.riskDetail}>
                        scorta {f.stock}  ·  {f.sold7d}/sett
                      </Text>
                    </View>
                    <Text style={{ fontSize: 16 }}>{f.trend}</Text>
                    {f.order > 0 && (
                      <View style={[s.orderBadge, { backgroundColor: C.amberGlow, borderColor: C.amberBdr }]}>
                        <Text style={{ color: C.amber, fontWeight: '700', fontSize: 12 }}>+{f.order}</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          <View style={{ height: 32 }} />
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  fill:   { flex: 1 },
  header:    { paddingHorizontal: 20, paddingTop: 54, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.bg },
  logo:      { width: 150, height: 52 },
  shopName:  { color: C.textSub, fontSize: 11, fontWeight: '600' },
  headerSub: { color: C.muted, fontSize: 10 },
  body:   { paddingHorizontal: 16 },

  heroCard: {
    borderRadius: 16, padding: 22, marginBottom: 16,
    overflow: 'hidden',
  },
  heroLabel: { color: 'rgba(255,255,255,0.80)', fontSize: 9, fontWeight: '700', letterSpacing: 3, marginBottom: 8 },
  heroVal:   { color: '#FFFFFF', fontSize: 68, fontWeight: '800', lineHeight: 76, marginBottom: 18 },
  heroRow:   { flexDirection: 'row' },
  heroStatN: { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
  heroStatL: { color: 'rgba(255,255,255,0.70)', fontSize: 10, marginTop: 2 },
  heroDiv:   { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.25)', alignSelf: 'center' },

  statGrid:    { flexDirection: 'row', gap: 10 },
  section:     { marginTop: 24 },
  sectionTitle:{ color: C.muted, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: 12 },
  chartCard:   { backgroundColor: C.s2, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.glassBdr },

  riskRow: {
    backgroundColor: C.s2, borderRadius: 10, padding: 12, marginBottom: 8,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: C.glassBdr,
  },
  riskLine:   { width: 3, alignSelf: 'stretch', borderRadius: 2, minHeight: 32 },
  riskName:   { color: C.text, fontWeight: '600', fontSize: 13 },
  riskDetail: { color: C.muted, fontSize: 11, marginTop: 2 },
  orderBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1 },
});
