import { useState, useMemo } from 'react';
import { Download, FileSpreadsheet, ChevronDown, ChevronRight, ChevronsUpDown, ChevronsDownUp, TrendingUp, BarChart2, Tags, FileBarChart } from 'lucide-react';
import { useTransactions } from '../../hooks/useTransactions';
import { useCategories } from '../../hooks/useCategories';
import { useBudgets } from '../../hooks/useBudgets';
import { useAccounts } from '../../hooks/useAccounts';
import { useFamilyMembers } from '../../hooks/useFamilyMembers';
import { useTitularMappings } from '../../hooks/useTitularMappings';
import { useProjects } from '../../hooks/useProjects';
import { MonthSelector } from '../shared/MonthSelector';
import { CategoryIcon } from '../shared/CategoryIcon';
import { CashFlowReport } from './CashFlowReport';
import { CategoryEvolutionReport } from './CategoryEvolutionReport';
import { FinancialChat } from './FinancialChat';
import { ExportFullReportModal } from './ExportFullReportModal';
import { TransactionEditModal } from '../transactions/TransactionEditModal';
import { formatBRL, formatDate, getMonthYear, getMonthLabel } from '../../lib/utils';
import type { Transaction, Category } from '../../types';

type ReportTab = 'categorias' | 'fluxo' | 'evolucao';

interface CategoryGroup {
  category: Category | null;
  label: string;
  icon: string;
  total: number;
  percentage: number;
  subs: SubCategoryGroup[];
}

interface SubCategoryGroup {
  category: Category | null;
  label: string;
  icon: string;
  total: number;
  percentage: number;
  transactions: Transaction[];
}

export function ReportsPage() {
  const { transactions, loading, updateTransaction, deleteTransaction } = useTransactions();
  const { categories, rootCategories, subCategories } = useCategories();
  const { budgets } = useBudgets();
  const { accounts, accountNames } = useAccounts();
  const { memberNames: familyMemberNames } = useFamilyMembers();
  const { titularNames } = useTitularMappings();
  const { activeProjects } = useProjects();
  const [activeTab, setActiveTab] = useState<ReportTab>('categorias');
  const [monthYear, setMonthYear] = useState(getMonthYear());
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set());
  const [fullReportOpen, setFullReportOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

  const availableMonths = useMemo(() => {
    const set = new Set(transactions.map((t) => getMonthYear(t.date)));
    set.add(getMonthYear());
    return Array.from(set).sort().reverse();
  }, [transactions]);

  const monthTransactions = useMemo(
    () => transactions.filter((t) => getMonthYear(t.date) === monthYear),
    [transactions, monthYear]
  );

  const totalEntries = useMemo(
    () => monthTransactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0),
    [monthTransactions]
  );
  const totalExits = useMemo(
    () => monthTransactions.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0),
    [monthTransactions]
  );
  const totalBalance = totalEntries + totalExits;

  const filteredTransactions = monthTransactions;

  const totalFiltered = useMemo(
    () => filteredTransactions.reduce((s, t) => s + Math.abs(t.amount), 0),
    [filteredTransactions]
  );

  // Group by category → subcategory → transactions
  const grouped = useMemo(() => {
    const catMap = new Map<string, Transaction[]>();

    for (const t of filteredTransactions) {
      const key = t.categoryId || '__uncategorized';
      if (!catMap.has(key)) catMap.set(key, []);
      catMap.get(key)!.push(t);
    }

    const groups: CategoryGroup[] = [];

    // Process root categories
    for (const root of rootCategories) {
      const subs = subCategories(root.id);
      const subGroups: SubCategoryGroup[] = [];

      // Direct transactions on root category
      const directTxs = catMap.get(root.id) || [];
      if (directTxs.length > 0) {
        const subTotal = directTxs.reduce((s, t) => s + t.amount, 0);
        subGroups.push({
          category: root,
          label: root.name,
          icon: root.icon,
          total: subTotal,
          percentage: totalFiltered > 0 ? (Math.abs(subTotal) / totalFiltered) * 100 : 0,
          transactions: directTxs.sort((a, b) => a.date.getTime() - b.date.getTime()),
        });
        catMap.delete(root.id);
      }

      // Subcategory transactions
      for (const sub of subs) {
        const txs = catMap.get(sub.id) || [];
        if (txs.length > 0) {
          const subTotal = txs.reduce((s, t) => s + t.amount, 0);
          subGroups.push({
            category: sub,
            label: sub.name,
            icon: sub.icon,
            total: subTotal,
            percentage: totalFiltered > 0 ? (Math.abs(subTotal) / totalFiltered) * 100 : 0,
            transactions: txs.sort((a, b) => a.date.getTime() - b.date.getTime()),
          });
          catMap.delete(sub.id);
        }
      }

      if (subGroups.length > 0) {
        // Sort subgroups: receitas first (by value desc), then despesas (by abs value desc)
        subGroups.sort((a, b) => {
          const aReceita = a.total >= 0;
          const bReceita = b.total >= 0;
          if (aReceita !== bReceita) return aReceita ? -1 : 1;
          return Math.abs(b.total) - Math.abs(a.total);
        });
        const groupTotal = subGroups.reduce((s, g) => s + g.total, 0);
        groups.push({
          category: root,
          label: root.name,
          icon: root.icon,
          total: groupTotal,
          percentage: totalFiltered > 0 ? (Math.abs(groupTotal) / totalFiltered) * 100 : 0,
          subs: subGroups,
        });
      }
    }

    // Remaining uncategorized or orphan transactions
    for (const [key, txs] of catMap) {
      const cat = categories.find((c) => c.id === key);
      const total = txs.reduce((s, t) => s + t.amount, 0);
      groups.push({
        category: cat || null,
        label: cat?.name || 'Sem categoria',
        icon: cat?.icon || 'circle-ellipsis',
        total,
        percentage: totalFiltered > 0 ? (Math.abs(total) / totalFiltered) * 100 : 0,
        subs: [{
          category: cat || null,
          label: cat?.name || 'Sem categoria',
          icon: cat?.icon || 'circle-ellipsis',
          total,
          percentage: totalFiltered > 0 ? (Math.abs(total) / totalFiltered) * 100 : 0,
          transactions: txs.sort((a, b) => a.date.getTime() - b.date.getTime()),
        }],
      });
    }

    // Sort: receitas (total >= 0) first by value desc, then despesas (total < 0) by abs value desc
    groups.sort((a, b) => {
      const aReceita = a.total >= 0;
      const bReceita = b.total >= 0;
      if (aReceita !== bReceita) return aReceita ? -1 : 1;
      return Math.abs(b.total) - Math.abs(a.total);
    });
    return groups;
  }, [filteredTransactions, categories, rootCategories, subCategories, totalFiltered]);

  function toggleCat(id: string) {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSub(id: string) {
    setExpandedSubs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    const catIds = new Set(grouped.map((g) => g.category?.id || g.label));
    const subIds = new Set(grouped.flatMap((g) => g.subs.map((s) => s.category?.id || s.label)));
    setExpandedCats(catIds);
    setExpandedSubs(subIds);
  }

  function collapseAll() {
    setExpandedCats(new Set());
    setExpandedSubs(new Set());
  }

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const rows: Record<string, string | number>[] = [];

    for (const group of grouped) {
      for (const sub of group.subs) {
        for (const t of sub.transactions) {
          rows.push({
            'Data': formatDate(t.date),
            'Descricao': t.description,
            'Valor': t.amount,
            'Categoria': group.label,
            'Subcategoria': group.subs.length > 1 || sub.label !== group.label ? sub.label : '',
            'Conta': t.account,
            'Titular': t.titular,
            'Parcela': t.totalInstallments ? `${t.installmentNumber}/${t.totalInstallments}` : '',
            'Observacao': t.notes,
          });
        }
      }
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Relatório');

    // Auto-width
    const colWidths = Object.keys(rows[0] || {}).map((key) => ({
      wch: Math.max(key.length, ...rows.map((r) => String(r[key] || '').length)) + 2,
    }));
    ws['!cols'] = colWidths;

    XLSX.writeFile(wb, `relatorio_${monthYear}.xlsx`);
  }

  async function exportPDF() {
    const { default: jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;

    const doc = new jsPDF({ orientation: 'landscape' });
    const title = `Relatório por Categoria — ${getMonthLabel(monthYear)}`;

    doc.setFontSize(14);
    doc.text(title, 14, 15);

    doc.setFontSize(9);
    doc.text(`Receitas: ${formatBRL(totalEntries)}   |   Despesas: ${formatBRL(totalExits)}   |   Saldo: ${formatBRL(totalBalance)}`, 14, 22);

    const tableRows: (string | number)[][] = [];

    for (const group of grouped) {
      // Category header row
      tableRows.push([
        '',
        `${group.label} (${group.percentage.toFixed(1)}%)`,
        '',
        '',
        formatBRL(group.total),
      ]);

      for (const sub of group.subs) {
        // Subcategory header (if different from parent)
        if (group.subs.length > 1 || sub.label !== group.label) {
          tableRows.push([
            '',
            `    ${sub.label} (${sub.percentage.toFixed(1)}%)`,
            '',
            '',
            formatBRL(sub.total),
          ]);
        }

        for (const t of sub.transactions) {
          tableRows.push([
            formatDate(t.date),
            `        ${t.description}`,
            t.account,
            t.titular,
            formatBRL(t.amount),
          ]);
        }
      }
    }

    autoTable(doc, {
      startY: 27,
      head: [['Data', 'Descricao', 'Conta', 'Titular', 'Valor']],
      body: tableRows,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [245, 158, 11], textColor: [0, 0, 0], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 40 },
        3: { cellWidth: 35 },
        4: { cellWidth: 28, halign: 'right' },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      didParseCell: (data: any) => {
        const rowData = tableRows[data.row.index];
        if (rowData && !rowData[0]) {
          // Category/subcategory header row
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = [30, 30, 30];
        }
      },
    });

    doc.save(`relatorio_${monthYear}.pdf`);
  }

  if (loading) {
    return <div className="text-accent text-sm animate-pulse">Carregando...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold text-text-primary">Relatorios</h2>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-border pb-0">
        {([
          ['categorias', Tags, 'Por Categoria'],
          ['fluxo', TrendingUp, 'Fluxo de Caixa'],
          ['evolucao', BarChart2, 'Evolucao por Categoria'],
        ] as [ReportTab, React.ElementType, string][]).map(([tab, Icon, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs rounded-t transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? 'text-accent border-accent bg-accent/5'
                : 'text-text-secondary border-transparent hover:text-text-primary hover:border-border'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* Fluxo de Caixa */}
      {activeTab === 'fluxo' && <CashFlowReport />}

      {/* Evolucao por Categoria */}
      {activeTab === 'evolucao' && <CategoryEvolutionReport />}

      {/* Por Categoria - existing report */}
      {activeTab === 'categorias' && <>

      {/* Range bar */}
      <div className="flex items-center gap-4 flex-wrap px-4 py-2.5 bg-bg-secondary border border-border rounded-lg">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-secondary">Mes:</span>
          <MonthSelector value={monthYear} onChange={setMonthYear} months={availableMonths} />
        </div>
        <div className="ml-auto flex gap-1 flex-wrap">
          <button
            onClick={expandAll}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-card border border-border text-text-primary text-xs rounded hover:border-accent"
            title="Expandir tudo"
          >
            <ChevronsUpDown size={13} /> Expandir tudo
          </button>
          <button
            onClick={collapseAll}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-card border border-border text-text-primary text-xs rounded hover:border-accent"
            title="Recolher tudo"
          >
            <ChevronsDownUp size={13} /> Recolher tudo
          </button>
          <button
            onClick={exportExcel}
            disabled={filteredTransactions.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-card border border-border text-text-primary text-xs rounded hover:border-accent disabled:opacity-30"
            title="Exportar Excel"
          >
            <FileSpreadsheet size={13} /> Excel
          </button>
          <button
            onClick={exportPDF}
            disabled={filteredTransactions.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-card border border-border text-text-primary text-xs rounded hover:border-accent disabled:opacity-30"
            title="Exportar PDF"
          >
            <Download size={13} /> PDF
          </button>
          <button
            onClick={() => setFullReportOpen(true)}
            disabled={transactions.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-card border border-border text-text-primary text-xs rounded hover:border-accent disabled:opacity-30"
            title="Gerar PDF consolidado com dashboard + relatórios no padrão McKinsey"
          >
            <FileBarChart size={13} /> Exportar Relatório Completo
          </button>
        </div>
      </div>

      {/* Main content - side by side layout */}
      <div className="flex gap-4 items-start">
        {/* Left column - Summary */}
        <div className="space-y-3 w-[220px] flex-shrink-0">
          {/* Summary card */}
          <div className="bg-bg-card border border-border rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">Receitas</span>
              <span className="text-accent-green font-bold">{formatBRL(totalEntries)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-text-secondary">Despesas</span>
              <span className="text-accent-red font-bold">{formatBRL(totalExits)}</span>
            </div>
            <div className="border-t border-border pt-2 flex justify-between text-xs">
              <span className="text-text-secondary">Total</span>
              <span className={`font-bold ${totalBalance >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                {formatBRL(totalBalance)}
              </span>
            </div>
          </div>

          {/* Transaction count */}
          <div className="text-xs text-text-secondary">
            {filteredTransactions.length} lancamentos em {grouped.length} categorias
          </div>
        </div>

        {/* Right column - Categories */}
        <div className="flex-1 min-w-0">
          {grouped.length === 0 ? (
            <div className="bg-bg-card border border-border rounded-lg p-8 text-center text-text-secondary text-sm">
              Nenhum lancamento neste periodo.
            </div>
          ) : (
            <div className="space-y-1">
              {grouped.map((group) => {
                const catKey = group.category?.id || group.label;
                const isCatExpanded = expandedCats.has(catKey);

                return (
                  <div key={catKey} className="bg-bg-card border border-border rounded-lg overflow-hidden">
                    {/* Category header */}
                    <button
                      onClick={() => toggleCat(catKey)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-secondary/40 transition-colors"
                    >
                      {isCatExpanded ? <ChevronDown size={14} className="text-text-secondary" /> : <ChevronRight size={14} className="text-text-secondary" />}
                      <CategoryIcon icon={group.icon} size={16} style={{ color: group.category?.color || 'var(--text-primary)' }} />
                      <span className="text-xs" style={{ color: group.category?.color || 'var(--text-primary)' }}>{group.label}</span>
                      <span className="text-[10px] text-text-secondary">({group.percentage.toFixed(1)}%)</span>
                      <span className={`ml-auto text-xs font-bold font-mono ${group.total >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                        {formatBRL(group.total)}
                      </span>
                    </button>

                    {/* Subcategories */}
                    {isCatExpanded && group.subs.map((sub) => {
                      const subKey = sub.category?.id || sub.label;
                      const isSubExpanded = expandedSubs.has(subKey);
                      const showSubHeader = group.subs.length > 1 || sub.label !== group.label;

                      return (
                        <div key={subKey}>
                          {/* Subcategory header */}
                          {showSubHeader && (
                            <button
                              onClick={() => toggleSub(subKey)}
                              className="w-full flex items-center gap-3 px-4 py-2 pl-10 border-t border-border/40 hover:bg-bg-secondary/20 transition-colors"
                            >
                              {isSubExpanded ? <ChevronDown size={12} className="text-text-secondary" /> : <ChevronRight size={12} className="text-text-secondary" />}
                              <CategoryIcon icon={sub.icon} size={14} style={{ color: sub.category?.color || 'var(--text-primary)' }} />
                              <span className="text-xs" style={{ color: sub.category?.color || 'var(--text-primary)' }}>{sub.label}</span>
                              <span className="text-[10px] text-text-secondary">({sub.percentage.toFixed(1)}%)</span>
                              <span className={`ml-auto text-xs font-bold font-mono ${sub.total >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                                {formatBRL(sub.total)}
                              </span>
                            </button>
                          )}

                          {/* Transactions */}
                          {(showSubHeader ? isSubExpanded : isCatExpanded) && (
                            <div className="border-t border-border/30">
                              {sub.transactions.map((t) => (
                                <button
                                  type="button"
                                  key={t.id}
                                  onClick={() => setEditingTransaction(t)}
                                  title="Clique para editar o lançamento"
                                  className="w-full flex items-center gap-4 px-4 py-2 pl-16 border-b border-border/20 last:border-b-0 hover:bg-bg-secondary/30 text-xs text-left cursor-pointer transition-colors"
                                >
                                  <span className="text-text-secondary w-16 flex-shrink-0 font-mono border-r border-border/40 pr-2">
                                    {formatDate(t.date)}
                                  </span>
                                  <div className="flex-1 min-w-0 flex items-baseline gap-2 overflow-hidden">
                                    <span className="text-text-primary truncate min-w-0 shrink">{t.description}</span>
                                    <span className="text-[10px] text-text-secondary flex-shrink-0 whitespace-nowrap">
                                      {t.account}{t.titular && ` · ${t.titular}`}{t.totalInstallments && ` · ${t.installmentNumber}/${t.totalInstallments}`}
                                    </span>
                                  </div>
                                  <span className={`font-mono font-bold flex-shrink-0 ${t.amount >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                                    {formatBRL(t.amount)}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      </>}

      <FinancialChat transactions={transactions} categories={categories} budgets={budgets} />

      <ExportFullReportModal open={fullReportOpen} onClose={() => setFullReportOpen(false)} />

      {editingTransaction && (
        <TransactionEditModal
          transaction={editingTransaction}
          onSave={updateTransaction}
          onDelete={deleteTransaction}
          onClose={() => setEditingTransaction(null)}
          categories={categories}
          accounts={accounts}
          accountNames={accountNames}
          titularNames={familyMemberNames.length > 0 ? familyMemberNames : titularNames}
          projects={activeProjects}
        />
      )}
    </div>
  );
}
