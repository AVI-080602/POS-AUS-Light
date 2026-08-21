import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  ShoppingCartIcon,
  ClipboardDocumentListIcon,
  UsersIcon,
  DocumentTextIcon,
  PhoneIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  ArrowRightOnRectangleIcon,
  UserGroupIcon,
  BookOpenIcon,
  ShieldCheckIcon,
  CurrencyDollarIcon,
} from '@heroicons/react/24/outline';
import { RootState, AppDispatch } from '../../store';
import { logout } from '../../store/slices/authSlice';

const navItems = [
  { to: '/pos', label: 'Products', icon: ShoppingCartIcon },
  { to: '/orders', label: 'Orders', icon: ClipboardDocumentListIcon },
  { to: '/customers', label: 'Customers', icon: UsersIcon },
  { to: '/quotes', label: 'Quotes', icon: DocumentTextIcon },
  { to: '/inquiries', label: 'Inquiries', icon: PhoneIcon },
  { to: '/suppliers', label: 'Suppliers', icon: BookOpenIcon },
  { to: '/warranties', label: 'Warranty', icon: ShieldCheckIcon },
  { to: '/users', label: 'Users', icon: UserGroupIcon },
];

const managerNavItems = [
  { to: '/reports', label: 'Reports', icon: ChartBarIcon },
];

const adminNavItems = [
  { to: '/competitor-prices', label: 'Prices', icon: CurrencyDollarIcon },
  { to: '/settings', label: 'Settings', icon: Cog6ToothIcon },
];

export default function MainLayout() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { user } = useSelector((state: RootState) => state.auth);

  const handleLogout = () => {
    dispatch(logout());
    navigate('/login');
  };

  const isAdmin = user?.role.name === 'admin';
  const isManagerOrAdmin = user?.role.name === 'admin' || user?.role.name === 'manager';

  return (
    <div className="flex h-screen bg-pos-bg">
      {/* Sidebar */}
      <aside className="w-20 bg-pos-card border-r border-gray-700 flex flex-col">
        {/* Logo */}
        <div className="h-12 flex items-center justify-center border-b border-gray-700">
          <span className="text-xl font-bold text-primary-500">ALF</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center h-12 mx-1 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-400 hover:bg-pos-accent hover:text-white'
                }`
              }
            >
              <item.icon className="h-5 w-5" />
              <span className="text-[10px] mt-0.5">{item.label}</span>
            </NavLink>
          ))}

          {isManagerOrAdmin && managerNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center h-12 mx-1 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-400 hover:bg-pos-accent hover:text-white'
                }`
              }
            >
              <item.icon className="h-5 w-5" />
              <span className="text-[10px] mt-0.5">{item.label}</span>
            </NavLink>
          ))}

          {isAdmin && (
            <>
              <div className="border-t border-gray-700 mx-3 my-1" />
              {adminNavItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex flex-col items-center justify-center h-12 mx-1 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-primary-600 text-white'
                        : 'text-gray-400 hover:bg-pos-accent hover:text-white'
                    }`
                  }
                >
                  <item.icon className="h-5 w-5" />
                  <span className="text-[10px] mt-0.5">{item.label}</span>
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* User & Logout */}
        <div className="border-t border-gray-700 p-1">
          <div className="flex flex-col items-center text-center mb-1">
            <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
              {user?.firstName[0]}
              {user?.lastName[0]}
            </div>
            <span className="text-[10px] text-gray-400 mt-0.5 truncate w-full">
              {user?.firstName}
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex flex-col items-center justify-center h-10 rounded-lg text-gray-400 hover:bg-red-600/20 hover:text-red-400 transition-colors"
          >
            <ArrowRightOnRectangleIcon className="h-4 w-4" />
            <span className="text-[10px] mt-0.5">Logout</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
