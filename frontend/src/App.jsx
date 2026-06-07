import { AppProvider } from './context/App_Provider';
import { App_Shell } from './components/app/App_Shell';
import { AuthScreen } from './components/Auth_Screen';
import { useApp } from './context/App_Context';

function AppGate() {
  const { authReady, onLoggedIn } = useApp();
  if (!authReady) {
    return <AuthScreen onLoggedIn={onLoggedIn} />;
  }
  return <App_Shell />;
}

export default function App() {
  return (
    <AppProvider>
      <AppGate />
    </AppProvider>
  );
}
