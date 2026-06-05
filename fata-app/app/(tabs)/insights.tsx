import { useCallback, useEffect, useState } from 'react';
import { View, ActivityIndicator, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { WebView } from 'react-native-webview';
import { getInsightsHtml } from '../../lib/api';
import { C } from '../../lib/theme';

export default function InsightsScreen() {
  const [html,       setHtml]       = useState<string | null>(null);
  const [webLoading, setWebLoading] = useState(true);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHtml(null);
    setWebLoading(true);
    try {
      const h = await getInsightsHtml();
      setHtml(h);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <View style={s.center}>
      <ActivityIndicator size="large" color={C.amber} />
    </View>
  );

  if (error) return (
    <View style={s.center}>
      {error.includes('404') ? (
        <>
          <Text style={s.emptyTitle}>Nessun dato ancora</Text>
          <Text style={s.emptySub}>
            Vai su Ordini e avvia un'estrazione per generare il report.
          </Text>
        </>
      ) : (
        <Text style={s.errText}>⚠️  {error}</Text>
      )}
      <TouchableOpacity style={s.retryBtn} onPress={load}>
        <Text style={s.retryTxt}>Riprova</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f0f4f8' }}>
      {webLoading && (
        <View style={s.loadBar}>
          <ActivityIndicator size="small" color={C.amber} />
          <Text style={s.loadTxt}>Caricamento insights…</Text>
        </View>
      )}
      <WebView
        source={{ html: html!, baseUrl: '' }}
        style={{ flex: 1 }}
        onLoadEnd={() => setWebLoading(false)}
        onError={() => setError('Impossibile renderizzare gli insights.')}
        onHttpError={(e) => {
          if (e.nativeEvent.statusCode >= 400)
            setError(`Errore server: ${e.nativeEvent.statusCode}`);
        }}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        mixedContentMode="always"
      />
    </View>
  );
}

const s = StyleSheet.create({
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: C.bg },
  emptyTitle: { color: C.textSub, fontSize: 16, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  emptySub:   { color: C.muted, fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  errText:    { color: C.terra, textAlign: 'center', fontSize: 14, lineHeight: 22, marginBottom: 24 },
  retryBtn:   { borderRadius: 10, paddingHorizontal: 28, paddingVertical: 12, backgroundColor: C.amberGlow, borderWidth: 1, borderColor: C.amberBdr },
  retryTxt:   { color: C.amber, fontWeight: '700', fontSize: 14 },
  loadBar:    { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  loadTxt:    { color: '#64748b', fontSize: 13 },
});
