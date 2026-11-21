import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import Transactions from './pages/Transactions';
import FraudDetection from './pages/FraudDetection';
import Monitoring from './pages/Monitoring';
import Performance from './pages/Performance';
import Alerts from './pages/Alerts';
import SettingsPage from './pages/Settings';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Overview />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="fraud-detection" element={<FraudDetection />} />
        <Route path="monitoring" element={<Monitoring />} />
        <Route path="performance" element={<Performance />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
