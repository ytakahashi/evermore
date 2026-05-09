import { AppShell } from './components/layout/AppShell';
import { usePaneInfoBridge } from './hooks/usePaneInfoBridge';
import { useTunnelEventBridge } from './hooks/useTunnelEventBridge';

export default function App(): React.JSX.Element {
  usePaneInfoBridge();
  useTunnelEventBridge();

  return <AppShell />;
}
