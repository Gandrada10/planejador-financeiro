import { useState, useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  LayoutDashboard,
  ArrowLeftRight,
  CreditCard,
  Tags,
  Target,
  Settings,
  LogOut,
  Menu,
  X,
  FileBarChart,
  FolderKanban,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { cn } from '../lib/utils';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/transacoes', icon: ArrowLeftRight, label: 'Transacoes' },
  { to: '/cartoes', icon: CreditCard, label: 'Cartoes' },
  { to: '/categorias', icon: Tags, label: 'Categorias' },
  { to: '/projetos', icon: FolderKanban, label: 'Projetos' },
  { to: '/relatorios', icon: FileBarChart, label: 'Relatorios' },
  { to: '/orcamento', icon: Target, label: 'Metas' },
  { to: '/configuracoes', icon: Settings, label: 'Configuracoes' },
];

const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed';

export function Layout() {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  });

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  return (
    <div className="min-h-screen flex bg-bg-primary">
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 bg-bg-secondary border-r border-border flex flex-col transition-[width,transform] lg:translate-x-0 lg:static w-48',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed && 'lg:w-14'
        )}
      >
        <div
          className={cn(
            'border-b border-border flex items-center gap-2',
            collapsed ? 'lg:justify-center lg:p-3 p-4 justify-between' : 'p-4 justify-between'
          )}
        >
          <div className={cn('min-w-0', collapsed && 'lg:hidden')}>
            <h1 className="text-accent font-bold text-sm tracking-wider">
              PLANEJADOR
            </h1>
            <p className="text-text-secondary text-[10px] tracking-widest">
              FINANCEIRO FAMILIAR
            </p>
          </div>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="hidden lg:block text-text-secondary hover:text-text-primary transition-colors flex-shrink-0"
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setSidebarOpen(false)}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 py-2 text-xs rounded transition-colors',
                  collapsed ? 'px-3 lg:px-0 lg:justify-center' : 'px-3',
                  isActive
                    ? 'bg-accent/10 text-accent border-l-2 border-accent'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-card'
                )
              }
            >
              <Icon size={16} className="flex-shrink-0" />
              <span className={cn(collapsed && 'lg:hidden')}>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div
          className={cn(
            'border-t border-border',
            collapsed ? 'p-3 lg:p-2' : 'p-3'
          )}
        >
          <div
            className={cn(
              'text-[10px] text-text-secondary truncate mb-2',
              collapsed && 'lg:hidden'
            )}
          >
            {user?.email}
          </div>
          <button
            onClick={logout}
            title={collapsed ? 'Sair' : undefined}
            aria-label="Sair"
            className={cn(
              'flex items-center gap-2 text-xs text-text-secondary hover:text-accent-red transition-colors',
              collapsed && 'lg:justify-center lg:w-full'
            )}
          >
            <LogOut size={14} className="flex-shrink-0" />
            <span className={cn(collapsed && 'lg:hidden')}>Sair</span>
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
      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        <header className="h-12 bg-bg-secondary border-b border-border flex items-center px-4 gap-3 lg:hidden">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Abrir menu">
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
