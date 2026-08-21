import { Routes, Route, Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { RootState } from './store';

// Layouts
import MainLayout from './components/layouts/MainLayout';
import AuthLayout from './components/layouts/AuthLayout';

// Pages
import LoginPage from './pages/auth/LoginPage';
import POSPage from './pages/pos/POSPage';
import OrdersPage from './pages/orders/OrdersPage';
import CustomersPage from './pages/customers/CustomersPage';
import QuotesPage from './pages/quotes/QuotesPage';
import InquiriesPage from './pages/inquiries/InquiriesPage';
import SuppliersPage from './pages/suppliers/SuppliersPage';
import WarrantiesPage from './pages/warranties/WarrantiesPage';
import ReportsPage from './pages/reports/ReportsPage';
import SettingsPage from './pages/settings/SettingsPage';
import UsersPage from './pages/users/UsersPage';
import PriceWatchPage from './pages/price-watch/PriceWatchPage';

// Protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useSelector((state: RootState) => state.auth);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// Admin-only route wrapper
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useSelector((state: RootState) => state.auth);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role.name !== 'admin') {
    return <Navigate to="/pos" replace />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <Routes>
      {/* Auth routes */}
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      {/* Protected routes */}
      <Route
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/pos" element={<POSPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/quotes" element={<QuotesPage />} />
        <Route path="/inquiries" element={<InquiriesPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/warranties" element={<WarrantiesPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/users" element={<UsersPage />} />

        {/* Admin only routes */}
        <Route
          path="/settings"
          element={
            <AdminRoute>
              <SettingsPage />
            </AdminRoute>
          }
        />
        <Route
          path="/competitor-prices"
          element={
            <AdminRoute>
              <PriceWatchPage />
            </AdminRoute>
          }
        />
      </Route>

      {/* Default redirect */}
      <Route path="/" element={<Navigate to="/pos" replace />} />
      <Route path="*" element={<Navigate to="/pos" replace />} />
    </Routes>
  );
}

export default App;
