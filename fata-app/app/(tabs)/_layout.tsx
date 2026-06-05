import { Tabs } from 'expo-router';
import { View, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../../lib/theme';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const TABS: { name: string; route: string; active: IoniconsName; inactive: IoniconsName }[] = [
  { name: 'Dashboard', route: 'index',    active: 'home',         inactive: 'home-outline'         },
  { name: 'Insights',  route: 'insights', active: 'bar-chart',    inactive: 'bar-chart-outline'    },
  { name: 'Ordini',    route: 'orders',   active: 'clipboard',    inactive: 'clipboard-outline'    },
  { name: 'Storico',   route: 'history',  active: 'time',         inactive: 'time-outline'         },
];

function TabIcon({ focused, active, inactive }: { focused: boolean; active: IoniconsName; inactive: IoniconsName }) {
  return (
    <View style={[ic.wrap, focused && ic.active]}>
      <Ionicons
        name={focused ? active : inactive}
        size={22}
        color={focused ? C.amber : C.muted}
      />
      {focused && <View style={ic.dot} />}
    </View>
  );
}

const ic = StyleSheet.create({
  wrap:   {
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, gap: 3,
  },
  active: { backgroundColor: C.amberGlow },
  dot:    { width: 4, height: 4, borderRadius: 2, backgroundColor: C.amber },
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
          height:          Platform.OS === 'ios' ? 88 : 66,
          paddingBottom:   Platform.OS === 'ios' ? 26 : 8,
          paddingTop:      8,
          // Elevation shadow (Android)
          elevation: 12,
          // iOS shadow
          shadowColor:   C.shadow,
          shadowOffset:  { width: 0, height: -2 },
          shadowOpacity: 1,
          shadowRadius:  8,
        },
        tabBarActiveTintColor:   C.amber,
        tabBarInactiveTintColor: C.muted,
        tabBarLabelStyle: {
          fontSize: 10, fontWeight: '600', letterSpacing: 0.2, marginTop: -2,
        },
      }}
    >
      {TABS.map(tab => (
        <Tabs.Screen
          key={tab.name}
          name={tab.route}
          options={{
            title: tab.name,
            tabBarIcon: ({ focused }) => (
              <TabIcon focused={focused} active={tab.active} inactive={tab.inactive} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
