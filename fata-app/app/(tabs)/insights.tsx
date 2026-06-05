import { useEffect, useState } from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { getInsightsHtml } from '../../lib/api';

export default function InsightsScreen() {
  const [html,       setHtml]       = useState<string | null>(null);
  const [webLoading, setWebLoading] = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  useEffect(() => {
    getInsightsHtml()
      .then(setHtml)
      .catch(e => setError(e.message));
  }, []);

  if (error) return (
    <View style={s.center}>
      <Text style={s.errText}>⚠️  {error}</Text>
    </View>
  );

  if (!html) return (
    <View style={s.center}>
      <ActivityIndicator size="large" color="#1a1a2e" />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f0f4f8' }}>
      {webLoading && (
        <View style={s.loadBar}>
          <ActivityIndicator size="small" color="#1a1a2e" />
          <Text style={s.loadTxt}>Caricamento insights…</Text>
        </View>
      )}
      <WebView
        // Render HTML string directly — avoids CDN/CORS blocking in WebView
        // that would prevent Chart.js from loading when loaded via a remote URI.
        source={{ html, baseUrl: '' }}
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
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errText: { color: '#ef4444', textAlign: 'center', fontSize: 14, lineHeight: 22 },
  loadBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
  },
  loadTxt: { color: '#64748b', fontSize: 13 },
});
