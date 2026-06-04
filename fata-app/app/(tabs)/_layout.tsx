import { Tabs } from 'expo-router';
import { Text, View, StyleSheet, Platform } from 'react-native';
import { C } from '../../lib/theme';

const ICONS = ['⊞','⊛','⊠','⊙'];
const NAMES = ['Dashboard','Insights','Ordini','Storico'];

function TabIcon({ index, focused }: { index: number; focused: boolean }) {
  return (
    <View style={[ic.wrap, focused && ic.active]}>
      <Text style={[ic.icon, { color: focused ? C.amber : C.muted }]}>
        {ICONS[index]}
      </Text>
    </View>
  );
}

const ic = StyleSheet.create({
  wrap:   { width: 40, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  active: { backgroundColor: C.amberGlow },
  icon:   { fontSize: 18, lineHeight: 22 },
});

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: C.s1,
          borderTopColor:  C.glassBdr,
          borderTopWidth:  1,
          height:       Platform.OS === 'ios' ? 84 : 62,
          paddingBottom: Platform.OS === 'ios' ? 24 : 6,
          paddingTop: 6,
        },
        tabBarActiveTintColor:   C.amber,
        tabBarInactiveTintColor: C.muted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
      }}
    >
      {NAMES.map((name, i) => (
        <Tabs.Screen
          key={name}
          name={i === 0 ? 'index' : i === 1 ? 'insights' : i === 2 ? 'orders' : 'history'}
          options={{ title: name, tabBarIcon: ({ focused }) => <TabIcon index={i} focused={focused} /> }}
        />
      ))}
    </Tabs>
  );
}
