import { Tabs } from 'expo-router'
import { Icon } from '@/presentation/components/Icon'
import { useTheme } from '@/presentation/theme/ThemeProvider'

export default function TabsLayout() {
  const theme = useTheme()

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.me,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
        tabBarLabelStyle: theme.typography.label,
      }}
    >
      <Tabs.Screen
        name="chat"
        options={{
          title: '대화',
          tabBarIcon: ({ color }) => (
            <Icon
              name="chat"
              size={22}
              color={color === theme.colors.me ? 'me' : 'textMuted'}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '설정',
          tabBarIcon: ({ color }) => (
            <Icon
              name="settings"
              size={22}
              color={color === theme.colors.me ? 'me' : 'textMuted'}
            />
          ),
        }}
      />
    </Tabs>
  )
}
