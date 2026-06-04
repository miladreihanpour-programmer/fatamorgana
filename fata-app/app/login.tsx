import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  Alert, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { login } from '../lib/api';
import { C } from '../lib/theme';

export default function LoginScreen() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [focusU,   setFocusU]   = useState(false);
  const [focusP,   setFocusP]   = useState(false);

  async function handleLogin() {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Campi vuoti', 'Inserisci username e password');
      return;
    }
    setLoading(true);
    try {
      await login(username.trim(), password.trim());
      router.replace('/(tabs)');
    } catch (e: any) {
      Alert.alert('Accesso negato', e.message ?? 'Credenziali non valide');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* Brand mark */}
          <View style={s.brand}>
            <View style={s.logoRing}>
              <Text style={s.logoLetters}>FM</Text>
              {/* Amber glow ring */}
              <View style={s.logoGlow} />
            </View>
            <Text style={s.appName}>Fata Morgana</Text>
            <Text style={s.appSub}>Gestione Inventario</Text>
          </View>

          {/* Form */}
          <View style={s.form}>

            <Text style={s.fieldLabel}>Username</Text>
            <View style={[s.inputWrap, focusU && s.inputActive]}>
              <TextInput
                style={s.input}
                placeholder="Username SHOCAPP"
                placeholderTextColor={C.muted}
                value={username}
                onChangeText={setUsername}
                onFocus={() => setFocusU(true)}
                onBlur={() => setFocusU(false)}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <Text style={[s.fieldLabel, { marginTop: 16 }]}>Password</Text>
            <View style={[s.inputWrap, focusP && s.inputActive]}>
              <TextInput
                style={s.input}
                placeholder="Password SHOCAPP"
                placeholderTextColor={C.muted}
                value={password}
                onChangeText={setPassword}
                onFocus={() => setFocusP(true)}
                onBlur={() => setFocusP(false)}
                secureTextEntry
              />
            </View>

            <TouchableOpacity
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.8}
              style={{ marginTop: 28 }}
            >
              <LinearGradient
                colors={loading ? [C.s3, C.s3] : C.gradAmber}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={s.btn}
              >
                {loading
                  ? <ActivityIndicator color={C.text} />
                  : <Text style={s.btnText}>Accedi</Text>
                }
              </LinearGradient>
            </TouchableOpacity>

            <Text style={s.hint}>
              Usa le credenziali del portale SHOCAPP
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 48 },

  // Brand
  brand: { alignItems: 'center', marginBottom: 48 },
  logoRing: {
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 1.5, borderColor: C.amberBdr,
    backgroundColor: C.amberGlow,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },
  logoGlow: {
    position: 'absolute', width: 80, height: 80, borderRadius: 40,
    backgroundColor: C.amber, opacity: 0.06,
  },
  logoLetters: { color: C.amber, fontSize: 22, fontWeight: '700', letterSpacing: 2 },
  appName:     { color: C.text, fontSize: 26, fontWeight: '700', letterSpacing: 0.5 },
  appSub:      { color: C.muted, fontSize: 13, marginTop: 6, letterSpacing: 0.3 },

  // Form
  form: {
    backgroundColor: C.s2,
    borderRadius: 16, padding: 24,
    borderWidth: 1, borderColor: C.glassBdr,
    shadowColor: C.shadow, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1, shadowRadius: 24, elevation: 8,
  },
  fieldLabel: { color: C.textSub, fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: 8 },
  inputWrap: {
    backgroundColor: C.s1, borderRadius: 10,
    borderWidth: 1, borderColor: C.glassBdr,
    paddingHorizontal: 14,
  },
  inputActive: { borderColor: C.amberBdr },
  input: { color: C.text, fontSize: 15, paddingVertical: 13 },

  btn:     { borderRadius: 10, paddingVertical: 15, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15, letterSpacing: 0.3 },
  hint:    { color: C.muted, fontSize: 11, textAlign: 'center', marginTop: 20 },
});
