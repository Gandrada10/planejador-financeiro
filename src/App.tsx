import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { DashboardPage } from './components/dashboard/DashboardPage';
import { TransactionsPage } from './components/transactions/TransactionsPage';
import { CategoriesPage } from './components/categories/CategoriesPage';
import { BudgetPage } from './components/budget/BudgetPage';

import { SettingsPage } from './components/settings/SettingsPage';
import { CreditCardPage } from './components/creditcard/CreditCardPage';
import { CategorizationPage } from './components/categorization/CategorizationPage';
import { ReportsPage } from './components/reports/ReportsPage';
import { ProjectsPage } from './components/projects/ProjectsPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Rota publica - categorização via link */}
        <Route path="/categorizar/:token" element={<CategorizationPage />} />

        {/* Rotas protegidas */}
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/transacoes" element={<TransactionsPage />} />
          <Route path="/cartoes" element={<CreditCardPage />} />
          <Route path="/categorias" element={<CategoriesPage />} />
          <Route path="/projetos" element={<ProjectsPage />} />
          <Route path="/relatorios" element={<ReportsPage />} />
          <Route path="/orcamento" element={<BudgetPage />} />
          <Route path="/configuracoes" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
