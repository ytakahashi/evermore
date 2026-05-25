import { AppShell } from './components/layout/AppShell';
import { usePaneInfoBridge } from './hooks/usePaneInfoBridge';
import { useSettingsBridge } from './hooks/useSettingsBridge';
import { useShortcutBridge } from './hooks/useShortcutBridge';
import { useTunnelEventBridge } from './hooks/useTunnelEventBridge';
import { useWindowBridge } from './hooks/useWindowBridge';

export default function App(): React.JSX.Element {
  usePaneInfoBridge();
  useSettingsBridge();
  useShortcutBridge();
  useTunnelEventBridge();
  useWindowBridge();

  return <AppShell />;
}
