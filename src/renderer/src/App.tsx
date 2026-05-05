import { AppShell } from './components/layout/AppShell';
import { useTunnelEventBridge } from './hooks/useTunnelEventBridge';

export default function App(): React.JSX.Element {
  useTunnelEventBridge();

  return <AppShell />;
}
