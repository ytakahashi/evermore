import { AppShell } from './components/layout/AppShell';
import { usePaneInfoBridge } from './hooks/usePaneInfoBridge';
import { useSettingsBridge } from './hooks/useSettingsBridge';
import { useTunnelEventBridge } from './hooks/useTunnelEventBridge';
import { useWindowBridge } from './hooks/useWindowBridge';

export default function App(): React.JSX.Element {
  usePaneInfoBridge();
  useSettingsBridge();
  useTunnelEventBridge();
  useWindowBridge();

  return <AppShell />;
}
