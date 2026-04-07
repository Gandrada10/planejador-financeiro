import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  LayoutDashboard,
  ArrowLeftRight,
  CreditCard,
  Tags,
  Wallet,
  Settings,
  LogOut,
  Menu,
  X,
  FileBarChart,
  FolderKanban,
} from 'lucide-react';
import { cn } from '../lib/utils';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/transacoes', icon: ArrowLeftRight, label: 'Transacoes' },
  { to: '/cartoes', icon: CreditCard, label: 'Cartoes' },
  { to: '/categorias', icon: Tags, label: 'Categorias' },
  { to: '/projetos', icon: FolderKanban, label: 'Projetos' },
  { to: '/relatorios', icon: FileBarChart, label: 'Relatorios' },
  { to: '/orcamento', icon: Wallet, label: 'Orcamento' },
  { to: '/configuracoes', icon: Settings, label: 'Configuracoes' },
];

export function Layout() {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-bg-primary">
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-56 bg-bg-secondary border-r border-border flex flex-col transition-transform lg:translate-x-0 lg:static',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="p-4 border-b border-border">
          <h1 className="text-accent font-bold text-sm tracking-wider">
            PLANEJADOR
          </h1>
          <p className="text-text-secondary text-[10px] tracking-widest">
            FINANCEIRO FAMILIAR
          </p>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 text-xs rounded transition-colors',
                  isActive
                    ? 'bg-accent/10 text-accent border-l-2 border-accent'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-card'
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-border">
          <div className="text-[10px] text-text-secondary truncate mb-2">
            {user?.email}
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 text-xs text-text-secondary hover:text-accent-red transition-colors"
          >
            <LogOut size={14} />
            Sair
          </button>
        </div>
      </aside>

      {/* Overlay mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-h-screen">
        <header className="h-12 bg-bg-secondary border-b border-border flex items-center px-4 gap-3 lg:hidden">
          <button onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <span className="text-accent text-xs font-bold tracking-wider">PLANEJADOR</span>
        </header>

        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
