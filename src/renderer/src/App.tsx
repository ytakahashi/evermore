import { AppShell } from './components/layout/AppShell';
import { usePaneInfoBridge } from './hooks/usePaneInfoBridge';
import { useSettingsBridge } from './hooks/useSettingsBridge';
import { useTunnelEventBridge } from './hooks/useTunnelEventBridge';

export default function App(): React.JSX.Element {
  usePaneInfoBridge();
  useSettingsBridge();
  useTunnelEventBridge();

  return <AppShell />;
}
