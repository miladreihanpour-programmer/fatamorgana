import { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { triggerExtraction, getExtractionStatus, getPdfUrl, type ExtractionStatus } from '../../lib/api';
import { C } from '../../lib/theme';

export default function OrdersScreen() {
  const [status,      setStatus]      = useState<ExtractionStatus | null>(null);
  const [starting,    setStarting]    = useState(false);
  const [downloading, setDownloading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchStatus() {
    try { setStatus(await getExtractionStatus()); } catch {}
  }

  useEffect(() => { fetchStatus(); }, []);

  useEffect(() => {
    if (status?.running) {
      pollRef.current = setInterval(fetchStatus, 2500);
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [status?.running]);

  async function handleExtract() {
    setStarting(true);
    try { await triggerExtraction(); await fetchStatus(); }
    catch (e: any) { Alert.alert('Errore', e.message); }
    finally { setStarting(false); }
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const url  = await getPdfUrl();
      const dest = (FileSystem.documentDirectory ?? '') + 'ordine_fata.pdf';
      const { uri } = await FileSystem.downloadAsync(url, dest);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
      } else {
        Alert.alert('Salvato', uri);
      }
    } catch (e: any) { Alert.alert('Errore', e.message); }
    finally { setDownloading(false); }
  }

  const running = status?.running ?? false;
  const last    = status?.lastResult;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView showsVerticalScrollIndicator={false}>

        <View style={s.header}>
          <Text style={s.title}>Ordini</Text>
          <Text style={s.sub}>Estrai · Calcola · Stampa</Text>
        </View>

        <View style={s.body}>

          {/* Last result */}
          {last && (
            <View style={s.resultCard}>
              <View style={s.resultHeader}>
                <View style={[s.dot, { backgroundColor: C.sageLt }]} />
                <Text style={[s.resultLbl, { color: C.sageLt }]}>Ultima estrazione completata</Text>
              </View>
              <Text style={s.resultDate}>
                {new Date(last.timestamp).toLocaleString('it-IT', {
                  day: '2-digit', month: 'long', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </Text>
              <View style={s.statRow}>
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={[s.statN, { color: C.amber }]}>{last.ordered}</Text>
                  <Text style={s.statL}>gusti</Text>
                </View>
                <View style={s.statDiv} />
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={[s.statN, { color: C.sageLt }]}>{last.totalVas}</Text>
                  <Text style={s.statL}>vaschette</Text>
                </View>
              </View>
            </View>
          )}

          {/* Extract CTA — primary action, bottom third friendly */}
          <TouchableOpacity
            onPress={handleExtract}
            disabled={running || starting}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={(running || starting) ? [C.s3, C.s3] : C.gradAmber}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={s.extractBtn}
            >
              {(starting || running)
                ? <><ActivityIndicator color={C.amber} style={{ marginRight: 8 }} />
                    <Text style={[s.extractTxt, { color: C.amber }]}>In corso…</Text></>
                : <Text style={s.extractTxt}>Avvia Estrazione</Text>
              }
            </LinearGradient>
          </TouchableOpacity>

          {/* Live progress */}
          {running && (
            <View style={s.logCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <ActivityIndicator size="small" color={C.amber} />
                <Text style={{ color: C.amber, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>
                  IN ESECUZIONE SU GITHUB
                </Text>
              </View>
              <Text style={[s.logLine, { color: C.textSub, marginBottom: 10 }]}>
                L'estrazione gira nel cloud. Ci vogliono circa 4-5 minuti.{'\n'}
                Puoi chiudere l'app — riceverai i risultati al rientro.
              </Text>
              {(status?.progress ?? []).map((line, i) => (
                <Text key={i} style={[s.logLine, { color: C.sageLt }]}>{line}</Text>
              ))}
            </View>
          )}

          {/* Completed */}
          {!running && (status?.progress?.length ?? 0) > 0 && status?.error && (
            <View style={[s.logCard, { borderLeftWidth: 3, borderLeftColor: C.terra }]}>
              <Text style={[s.logLine, { color: C.terra }]}>❌ {status.error}</Text>
            </View>
          )}

          {/* PDF row */}
          <TouchableOpacity
            onPress={handleDownload}
            disabled={downloading}
            activeOpacity={0.8}
            style={[s.pdfRow, downloading && { opacity: 0.4 }]}
          >
            {downloading
              ? <ActivityIndicator color={C.amber} />
              : <>
                  <View style={s.pdfIcon}>
                    <Text style={{ color: C.amber, fontSize: 18 }}>↓</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.pdfTitle}>Scarica PDF Ordine</Text>
                    <Text style={s.pdfSub}>Condividi l'ultimo ordine calcolato</Text>
                  </View>
                  <Text style={{ color: C.muted, fontSize: 20 }}>›</Text>
                </>
            }
          </TouchableOpacity>

        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 22, paddingTop: 56, paddingBottom: 16, backgroundColor: C.bg },
  title:  { color: C.text, fontSize: 24, fontWeight: '700' },
  sub:    { color: C.muted, fontSize: 11, marginTop: 4 },
  body:   { paddingHorizontal: 16, paddingBottom: 40 },

  resultCard: {
    backgroundColor: C.s2, borderRadius: 14, padding: 18, marginBottom: 14,
    borderWidth: 1, borderColor: C.glassBdr,
    borderLeftWidth: 3, borderLeftColor: C.sageLt,
  },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  dot:          { width: 8, height: 8, borderRadius: 4 },
  resultLbl:    { fontWeight: '700', fontSize: 12 },
  resultDate:   { color: C.textSub, fontSize: 12, marginBottom: 18 },
  statRow:      { flexDirection: 'row', alignItems: 'center' },
  statN:        { fontSize: 34, fontWeight: '800' },
  statL:        { color: C.muted, fontSize: 11, marginTop: 3 },
  statDiv:      { width: 1, height: 44, backgroundColor: C.glassBdr },

  extractBtn: {
    borderRadius: 12, paddingVertical: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  extractTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },

  logCard: {
    backgroundColor: C.s1, borderRadius: 12, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: C.glassBdr,
  },
  logLine: {
    color: C.textSub, fontSize: 12, lineHeight: 20,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  pdfRow: {
    backgroundColor: C.s2, borderRadius: 12, padding: 16, marginTop: 4,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderWidth: 1, borderColor: C.glassBdr,
  },
  pdfIcon: {
    width: 42, height: 42, borderRadius: 10,
    backgroundColor: C.amberGlow, borderWidth: 1, borderColor: C.amberBdr,
    alignItems: 'center', justifyContent: 'center',
  },
  pdfTitle: { color: C.text, fontWeight: '600', fontSize: 14 },
  pdfSub:   { color: C.muted, fontSize: 11, marginTop: 2 },
});
