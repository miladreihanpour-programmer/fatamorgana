import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  ActivityIndicator, TouchableOpacity, RefreshControl, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { getHistory, clearToken, type HistoryRow } from '../../lib/api';
import { C } from '../../lib/theme';

export default function HistoryScreen() {
  const router = useRouter();
  const [rows,       setRows]       = useState<HistoryRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try { setRows(await getHistory()); } catch {}
    setLoading(false); setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleLogout() {
    Alert.alert('Disconnetti', 'Uscire dall\'account?', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Esci', style: 'destructive', onPress: async () => {
        await clearToken(); router.replace('/login');
      }},
    ]);
  }

  const fmtDate = (ts: string) => new Date(ts).toLocaleString('it-IT', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>

      <View style={s.header}>
        <Text style={s.title}>Storico</Text>
        <Text style={s.sub}>Ultime 30 estrazioni</Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={C.amber} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={r => String(r.id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 8 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(true); }}
              tintColor={C.amber} />
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyTitle}>Nessuna estrazione ancora</Text>
              <Text style={s.emptySub}>Vai su Ordini e avvia la prima estrazione</Text>
            </View>
          }
          ListFooterComponent={
            rows.length > 0 ? (
              <TouchableOpacity style={s.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
                <Text style={s.logoutTxt}>Disconnetti</Text>
              </TouchableOpacity>
            ) : null
          }
          renderItem={({ item: r, index }) => (
            <View style={[s.row, index === 0 && s.rowTop]}>
              {/* Left accent bar */}
              <View style={[s.bar, { backgroundColor: r.status === 'ok' ? C.sageLt : C.terra }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.rowDate}>{fmtDate(r.ts)}</Text>
                <Text style={s.rowDetail}>{r.total_ord} gusti · {r.total_vas} vaschette</Text>
              </View>
              {/* Status badge */}
              <View style={[s.badge,
                r.status === 'ok'
                  ? { backgroundColor: C.sageBdr,  borderColor: C.sageLt  + '40' }
                  : { backgroundColor: C.terraBdr, borderColor: C.terraLt + '40' }
              ]}>
                <Text style={[s.badgeTxt, { color: r.status === 'ok' ? C.sageLt : C.terraLt }]}>
                  {r.status === 'ok' ? '✓' : '✗'}
                </Text>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 22, paddingTop: 56, paddingBottom: 16, backgroundColor: C.bg },
  title:  { color: C.text, fontSize: 24, fontWeight: '700' },
  sub:    { color: C.muted, fontSize: 11, marginTop: 4 },

  row: {
    backgroundColor: C.s2, borderRadius: 12, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: C.glassBdr, overflow: 'hidden',
  },
  rowTop: { borderColor: C.amberBdr, backgroundColor: C.s3 },
  bar:    { width: 3, alignSelf: 'stretch', borderRadius: 2, minHeight: 36 },
  rowDate:  { color: C.text, fontWeight: '600', fontSize: 13 },
  rowDetail:{ color: C.muted, fontSize: 11, marginTop: 3 },
  badge: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  badgeTxt: { fontSize: 14, fontWeight: '700' },

  empty:      { alignItems: 'center', paddingTop: 80 },
  emptyTitle: { color: C.textSub, fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptySub:   { color: C.muted, fontSize: 13 },

  logoutBtn: {
    marginTop: 16, borderRadius: 10, padding: 14, alignItems: 'center',
    borderWidth: 1, borderColor: C.terraBdr,
    backgroundColor: 'rgba(194,96,58,0.06)',
  },
  logoutTxt: { color: C.terra, fontWeight: '600', fontSize: 13 },
});
