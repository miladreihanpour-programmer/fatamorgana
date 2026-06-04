import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { getToken } from '../lib/api';

export default function RootLayout() {
  const router   = useRouter();
  const segments = useSegments();
  const [ready, setReady] = useState(false);

  // Re-check the token every time the active route changes.
  // This ensures that after login() saves the token and navigates
  // to /(tabs), the guard doesn't immediately redirect back to /login.
  useEffect(() => {
    getToken().then(token => {
      setReady(true);
      const inLoginScreen = segments[0] === 'login';
      if (!token && !inLoginScreen) router.replace('/login');
      if ( token &&  inLoginScreen) router.replace('/(tabs)');
    });
  }, [segments]);   // re-runs on every route change

  if (!ready) return null;

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
