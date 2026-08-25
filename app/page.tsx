'use client';

import { DragEvent, Fragment, useMemo, useRef, useState } from 'react';

type Entry = {
  id: string;
  file: string;
  line: number;
  date: string;
  voucher: string;
  accountNumber: number;
  account: string;
  description: string;
  amount: number;
};

type ValidationIssue = { file: string; line?: number; message: string };
type ImportedFile = { name: string; rows: number; issues: number };
type View = 'overview' | 'transactions' | 'taccounts' | 'trialbalance' | 'accountcards' | 'accounts' | 'import';

const moneyFormatter = new Intl.NumberFormat('da-DK', {
  style: 'currency',
  currency: 'DKK',
  minimumFractionDigits: 2,
});

const money = {
  format(value: number) {
    return moneyFormatter.format(Math.abs(value) < 0.005 ? 0 : value);
  },
};

const nav: { id: View; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overblik', icon: '●' },
  { id: 'transactions', label: 'Posteringer', icon: '↕' },
  { id: 'taccounts', label: 'T-konti', icon: 'T' },
  { id: 'trialbalance', label: 'Saldobalance', icon: 'Σ' },
  { id: 'accountcards', label: 'Kontokort', icon: '▤' },
  { id: 'accounts', label: 'Kontoplan', icon: '≡' },
  { id: 'import', label: 'Import', icon: '+' },
];

function parseAmount(raw: string) {
  const compact = raw.trim().replace(/\s/g, '');
  const normalized = compact.includes(',')
    ? compact.replace(/\./g, '').replace(',', '.')
    : compact;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function isRealDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function parseCsv(name: string, content: string) {
  const entries: Entry[] = [];
  const issues: ValidationIssue[] = [];
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    if (!rawLine.trim()) return;
    const line = index + 1;
    const fields = rawLine.split(';').map((field) => field.trim());
    if (fields.length !== 5) {
      issues.push({ file: name, line, message: `Forventede 5 felter, men fandt ${fields.length}.` });
      return;
    }

    const [date, voucher, account, description, rawAmount] = fields;
    const accountMatch = account.match(/^(\d+)\s+(.+)$/);
    const amount = parseAmount(rawAmount);
    const lineIssues: string[] = [];
    if (!isRealDate(date)) lineIssues.push('Dato skal være YYYY-MM-DD.');
    if (!/^\d+$/.test(voucher)) lineIssues.push('Bilag skal være et helt tal.');
    if (!accountMatch) lineIssues.push('Konto skal være et nummer efterfulgt af et navn.');
    if (!description) lineIssues.push('Tekst må ikke være tom.');
    if (amount === null) lineIssues.push('Beløb er ikke et gyldigt tal.');

    if (lineIssues.length) {
      lineIssues.forEach((message) => issues.push({ file: name, line, message }));
      return;
    }

    entries.push({
      id: `${name}-${line}-${date}-${voucher}`,
      file: name,
      line,
      date,
      voucher,
      accountNumber: Number(accountMatch![1]),
      account: `${accountMatch![1]} ${accountMatch![2].toLocaleUpperCase('da-DK')}`,
      description,
      amount: amount!,
    });
  });

  if (!entries.length && !issues.length) {
    issues.push({ file: name, message: 'Filen indeholder ingen posteringer.' });
  }

  return { entries, issues };
}

function dateLabel(value: string) {
  const [year, month, day] = value.split('-');
  return `${day}-${month}-${year}`;
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>('overview');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [files, setFiles] = useState<ImportedFile[]>([]);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showFormat, setShowFormat] = useState(false);
  const [query, setQuery] = useState('');

  const voucherIssues = useMemo<ValidationIssue[]>(() => {
    const sums = new Map<string, number>();
    entries.forEach((entry) => sums.set(entry.voucher, (sums.get(entry.voucher) ?? 0) + entry.amount));
    return [...sums.entries()]
      .filter(([, sum]) => Math.abs(sum) > 0.005)
      .map(([voucher, sum]) => ({ file: 'Regnskab', message: `Bilag ${voucher} er ude af balance med ${money.format(sum)}.` }));
  }, [entries]);

  const allIssues = [...issues, ...voucherIssues];
  const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
  const result = -entries.filter((entry) => entry.accountNumber < 10000).reduce((sum, entry) => sum + entry.amount, 0);
  const vouchers = new Set(entries.map((entry) => entry.voucher)).size;
  const years = [...new Set(entries.map((entry) => entry.date.slice(0, 4)))].sort();
  const period = years.length ? years.join('–') : '—';

  const accounts = useMemo(() => {
    const balances = new Map<number, { number: number; name: string; count: number; balance: number }>();
    entries.forEach((entry) => {
      const current = balances.get(entry.accountNumber) ?? { number: entry.accountNumber, name: entry.account.replace(/^\d+\s+/, ''), count: 0, balance: 0 };
      current.count += 1;
      current.balance += entry.amount;
      balances.set(entry.accountNumber, current);
    });
    return [...balances.values()].sort((a, b) => a.number - b.number);
  }, [entries]);

  const tAccounts = useMemo(() => accounts.map((account) => ({
    ...account,
    debit: entries.filter((entry) => entry.accountNumber === account.number && entry.amount >= 0),
    credit: entries.filter((entry) => entry.accountNumber === account.number && entry.amount < 0),
  })), [accounts, entries]);
  const driftTAccounts = tAccounts.filter((account) => account.number < 10000);
  const balanceTAccounts = tAccounts.filter((account) => account.number >= 10000);

  const accountCards = useMemo(() => accounts.map((account) => {
    let runningBalance = 0;
    const postings = entries
      .filter((entry) => entry.accountNumber === account.number)
      .sort((a, b) => a.date.localeCompare(b.date) || Number(a.voucher) - Number(b.voucher) || a.line - b.line)
      .map((entry) => {
        runningBalance += entry.amount;
        return { ...entry, runningBalance };
      });
    return { ...account, postings, closingBalance: runningBalance };
  }), [accounts, entries]);

  const trialBalance = useMemo(() => tAccounts.map((account) => {
    const debit = account.debit.reduce((sum, entry) => sum + entry.amount, 0);
    const credit = account.credit.reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
    const balance = debit - credit;
    const category = account.number < 10000 ? 'drift' : 'balance';
    const nature = category === 'drift'
      ? (balance <= 0 ? 'Indtægt' : 'Omkostning')
      : (balance >= 0 ? 'Aktiv' : 'Passiv');
    return { number: account.number, name: account.name, debit, credit, balance, category, nature };
  }), [tAccounts]);

  const trialTotals = trialBalance.reduce(
    (totals, account) => ({
      debit: totals.debit + account.debit,
      credit: totals.credit + account.credit,
      balance: totals.balance + account.balance,
    }),
    { debit: 0, credit: 0, balance: 0 },
  );

  const driftAccounts = trialBalance.filter((account) => account.category === 'drift');
  const balanceAccounts = trialBalance.filter((account) => account.category === 'balance');
  const driftDebit = driftAccounts.reduce((sum, account) => sum + account.debit, 0);
  const driftCredit = driftAccounts.reduce((sum, account) => sum + account.credit, 0);
  const driftResult = driftCredit - driftDebit;
  const balanceDebit = balanceAccounts.reduce((sum, account) => sum + account.debit, 0);
  const balanceCredit = balanceAccounts.reduce((sum, account) => sum + account.credit, 0);
  const assets = balanceAccounts.filter((account) => account.balance > 0).reduce((sum, account) => sum + account.balance, 0);
  const liabilities = balanceAccounts.filter((account) => account.balance < 0).reduce((sum, account) => sum + Math.abs(account.balance), 0);
  const balanceControl = assets - liabilities - driftResult;

  const filteredEntries = entries.filter((entry) => {
    const needle = query.toLowerCase();
    return !needle || `${entry.date} ${entry.voucher} ${entry.account} ${entry.description} ${entry.amount}`.toLowerCase().includes(needle);
  });

  async function importFiles(selected: File[]) {
    const csvFiles = selected.filter((file) => file.name.toLowerCase().endsWith('.csv'));
    if (!csvFiles.length) {
      setEntries([]);
      setFiles(selected.map((file) => ({ name: file.name, rows: 0, issues: 1 })));
      setIssues([{ file: selected[0]?.name ?? 'Fil', message: 'Vælg mindst én fil med endelsen .csv.' }]);
      setView('import');
      return;
    }

    const parsed = await Promise.all(csvFiles.map(async (file) => ({ name: file.name, ...parseCsv(file.name, await file.text()) })));
    const nextEntries = parsed.flatMap((result) => result.entries);
    const nextIssues = parsed.flatMap((result) => result.issues);
    setEntries(nextEntries);
    setIssues(nextIssues);
    setFiles(parsed.map((result) => ({ name: result.name, rows: result.entries.length, issues: result.issues.length })));
    setQuery('');
    setView(nextIssues.length ? 'import' : 'overview');
  }

  async function loadTestFile() {
    const name = 'test-regnskab.csv';
    try {
      const response = await fetch(name);
      if (!response.ok) throw new Error('Testfilen kunne ikke hentes.');
      const parsed = parseCsv(name, await response.text());
      setEntries(parsed.entries);
      setIssues(parsed.issues);
      setFiles([{ name, rows: parsed.entries.length, issues: parsed.issues.length }]);
      setQuery('');
      setView(parsed.issues.length ? 'import' : 'overview');
    } catch {
      setEntries([]);
      setFiles([{ name, rows: 0, issues: 1 }]);
      setIssues([{ file: name, message: 'Testfilen kunne ikke indlæses.' }]);
      setView('import');
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    void importFiles(Array.from(event.dataTransfer.files));
  }

  function reset() {
    setEntries([]);
    setFiles([]);
    setIssues([]);
    setQuery('');
    setView('import');
  }

  return (
    <main className="min-h-screen bg-[#f5f7f6] text-[#18201d]">
      <header className="sticky top-0 z-20 border-b border-[#dfe5e2] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5 sm:px-8">
          <button onClick={() => setView('overview')} className="flex items-center gap-3 text-left" aria-label="Gå til overblik">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#165c46] text-sm font-bold text-white shadow-sm">B</span>
            <span>
              <span className="block font-semibold leading-none">Bogført</span>
              <span className="mt-1 block text-[11px] text-[#68746f]">Enkel bogføring</span>
            </span>
          </button>
          <button onClick={() => setShowFormat(true)} className="rounded-lg border border-[#d8dfdc] px-3.5 py-2 text-sm font-medium text-[#44504b] transition hover:border-[#afbbb6] hover:bg-[#fafbfa]">Hjælp til format</button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] grid-cols-1 lg:grid-cols-[220px_1fr]">
        <aside className="hidden min-h-[calc(100vh-65px)] border-r border-[#dfe5e2] bg-white p-5 lg:block">
          <p className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#87918d]">Regnskab</p>
          {nav.map((item) => (
            <button key={item.id} onClick={() => setView(item.id)} className={`mb-1 flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm transition ${view === item.id ? 'bg-[#eaf3ef] font-semibold text-[#165c46]' : 'text-[#5d6863] hover:bg-[#f5f7f6]'}`}>
              <span className="mr-3 w-4 text-center text-xs">{item.icon}</span>{item.label}
              {item.id === 'import' && allIssues.length > 0 && <span className="ml-auto rounded-full bg-[#fbe9e7] px-2 py-0.5 text-[10px] font-bold text-[#a34848]">{allIssues.length}</span>}
            </button>
          ))}
          <div className="mt-8 border-t border-[#edf0ef] pt-5">
            <p className="px-3 text-xs text-[#87918d]">Data gemmes kun i din browser i denne version.</p>
          </div>
        </aside>

        <section className="min-w-0 px-5 pb-28 pt-5 sm:px-8 sm:pt-8 lg:p-10">
          <div className="mx-auto max-w-6xl">
            {view === 'overview' && (
              <>
                <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="mb-2 text-sm font-medium text-[#568170]">Regnskabsår {period}</p>
                    <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">Forstå bogføring – helt enkelt.</h1>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-[#68746f]">Store regnskabssystemer er ofte overkill, når målet er at forstå og lære bogføring. Her kan du følge simple posteringer gennem T-konti, saldobalance og kontokort.</p>
                    <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-[#3f7561]">Start med den medfølgende eksempelfil med 18 posteringer, eller indlæs dine egne CSV-filer.</p>
                  </div>
                  <button onClick={() => inputRef.current?.click()} className="rounded-xl bg-[#165c46] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#104d3a] focus:outline-none focus:ring-4 focus:ring-[#bed9cf]">Indlæs CSV-fil</button>
                </div>

                <div className="mb-6 grid gap-4 sm:grid-cols-3">
                  <Metric label="Resultat" value={money.format(result)} hint="Driftskonti under 10000" tone="green" />
                  <Metric label="Balance" value={money.format(total)} hint={Math.abs(total) < 0.005 ? '✓ Debet og kredit stemmer' : 'Kontrollér ubalancen'} tone={Math.abs(total) < 0.005 ? 'green' : 'red'} />
                  <Metric label="Posteringer" value={String(entries.length)} hint={`${vouchers} ${vouchers === 1 ? 'bilag' : 'bilag'} · ${files.length} ${files.length === 1 ? 'fil' : 'filer'}`} />
                </div>

                {entries.length ? (
                  <TransactionTable entries={entries.slice(0, 8)} subtitle={`${files.length} ${files.length === 1 ? 'fil' : 'filer'} indlæst`} valid={!allIssues.length} onShowAll={() => setView('transactions')} />
                ) : (
                  <EmptyImport isDragging={isDragging} setIsDragging={setIsDragging} handleDrop={handleDrop} onPick={() => inputRef.current?.click()} onLoadTest={loadTestFile} />
                )}
              </>
            )}

            {view === 'transactions' && (
              <>
                <PageHeading eyebrow={`${entries.length} linjer`} title="Posteringer" description="Alle gyldige posteringer på tværs af de indlæste filer." action="Indlæs flere filer" onAction={() => inputRef.current?.click()} />
                <div className="mb-4 flex items-center gap-3">
                  <label className="relative flex-1">
                    <span className="sr-only">Søg i posteringer</span>
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Søg på konto, bilag eller tekst …" className="w-full rounded-xl border border-[#d8dfdc] bg-white px-4 py-3 text-sm outline-none transition placeholder:text-[#9aa39f] focus:border-[#6b9b88] focus:ring-4 focus:ring-[#dcebe5]" />
                  </label>
                  <button onClick={() => setQuery('')} className="rounded-xl border border-[#d8dfdc] bg-white px-4 py-3 text-sm text-[#5d6863]">Ryd</button>
                </div>
                <TransactionTable entries={filteredEntries} subtitle={`${filteredEntries.length} vist`} valid={!allIssues.length} />
              </>
            )}

            {view === 'accounts' && (
              <>
                <PageHeading eyebrow={`${accounts.length} konti`} title="Kontoplan" description="Konti fundet automatisk i de indlæste posteringer." />
                <article className="overflow-hidden rounded-2xl border border-[#dfe5e2] bg-white shadow-[0_1px_2px_rgb(20_40_32/3%)]">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <thead className="bg-[#fafbfa] text-xs font-medium text-[#74807b]"><tr><th className="px-5 py-3">Kontonr.</th><th className="px-5 py-3">Kontonavn</th><th className="px-5 py-3">Posteringer</th><th className="px-5 py-3 text-right">Saldo</th></tr></thead>
                      <tbody className="divide-y divide-[#edf0ef]">
                        {accounts.map((account) => <tr key={account.number}><td className="px-5 py-4 font-mono text-xs text-[#68746f]">{account.number}</td><td className="px-5 py-4 font-medium">{account.name}</td><td className="px-5 py-4 text-[#68746f]">{account.count}</td><td className="px-5 py-4 text-right font-medium tabular-nums">{money.format(account.balance)}</td></tr>)}
                      </tbody>
                    </table>
                  </div>
                  {!accounts.length && <p className="p-8 text-center text-sm text-[#74807b]">Ingen konti endnu.</p>}
                </article>
              </>
            )}

            {view === 'taccounts' && (
              <>
                <PageHeading eyebrow={`${tAccounts.length} konti`} title="T-konti" description="Kontiene er opdelt i drift og balance. Debet står til venstre, kredit til højre." />
                {tAccounts.length ? (
                  <div className="space-y-10">
                    {[
                      {
                        label: 'Drift',
                        description: 'Resultatkonti under 10000',
                        accounts: driftTAccounts,
                        heading: 'border-[#e8d8b8] bg-[#fff6e5] text-[#7b5a22]',
                        badge: 'bg-white/70 text-[#7b5a22]',
                      },
                      {
                        label: 'Balance',
                        description: 'Aktiver og passiver fra 10000',
                        accounts: balanceTAccounts,
                        heading: 'border-[#bfdcd0] bg-[#edf6f2] text-[#24664e]',
                        badge: 'bg-white/70 text-[#24664e]',
                      },
                    ].map((section) => (
                      <section key={section.label}>
                        <div className={`mb-5 flex items-center justify-between rounded-2xl border px-5 py-4 ${section.heading}`}>
                          <div>
                            <h2 className="text-lg font-semibold">{section.label}</h2>
                            <p className="mt-0.5 text-xs opacity-75">{section.description}</p>
                          </div>
                          <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${section.badge}`}>{section.accounts.length} {section.accounts.length === 1 ? 'konto' : 'konti'}</span>
                        </div>
                        {section.accounts.length ? (
                          <div className="grid items-start gap-5 xl:grid-cols-2">
                            {section.accounts.map((account) => <TAccount key={account.number} account={account} />)}
                          </div>
                        ) : (
                          <p className="rounded-2xl border border-dashed border-[#dfe5e2] bg-white p-6 text-center text-sm text-[#74807b]">Ingen {section.label.toLocaleLowerCase('da-DK')}konti i det indlæste regnskab.</p>
                        )}
                      </section>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-2xl border border-[#dfe5e2] bg-white p-8 text-center text-sm text-[#74807b]">Indlæs en CSV-fil for at se T-konti.</p>
                )}
              </>
            )}

            {view === 'trialbalance' && (
              <>
                <PageHeading eyebrow={`${trialBalance.length} konti`} title="Saldobalance" description="Drift og balance er opdelt tydeligt med summer for resultat, aktiver og passiver." />
                <div className="mb-5 grid gap-4 md:grid-cols-3">
                  <article className="rounded-2xl border border-[#e8d8b8] bg-[#fffaf0] p-5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#8a6427]">Drift · resultat</p>
                    <p className={`mt-3 text-2xl font-semibold tabular-nums ${driftResult < 0 ? 'text-[#a34848]' : 'text-[#6f531f]'}`}>{money.format(driftResult)}</p>
                    <p className="mt-2 text-xs text-[#806f51]">Indtægter {money.format(driftCredit)} · omkostninger {money.format(driftDebit)}</p>
                  </article>
                  <article className="rounded-2xl border border-[#bfdcd0] bg-[#f2faf6] p-5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#247055]">Balance · aktiver</p>
                    <p className="mt-3 text-2xl font-semibold tabular-nums text-[#165c46]">{money.format(assets)}</p>
                    <p className="mt-2 text-xs text-[#568170]">Balancekonti med nettodebet</p>
                  </article>
                  <article className="rounded-2xl border border-[#d7d2e3] bg-[#f8f6fb] p-5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#675d7b]">Balance · passiver</p>
                    <p className="mt-3 text-2xl font-semibold tabular-nums text-[#4e465f]">{money.format(liabilities)}</p>
                    <p className="mt-2 text-xs text-[#766d87]">Balancekonti med nettokredit</p>
                  </article>
                </div>
                <div className={`mb-5 flex flex-col gap-1 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${Math.abs(balanceControl) < 0.005 ? 'border-[#bfdcd0] bg-[#edf8f3] text-[#196749]' : 'border-[#efc9c4] bg-[#fff5f4] text-[#a34848]'}`}>
                  <span className="font-semibold">{Math.abs(balanceControl) < 0.005 ? '✓ Balancen stemmer' : '! Balancen stemmer ikke'}</span>
                  <span className="text-xs">Aktiver = passiver + årets resultat · difference {money.format(balanceControl)}</span>
                </div>
                <article className="overflow-hidden rounded-2xl border border-[#dfe5e2] bg-white shadow-[0_1px_2px_rgb(20_40_32/3%)]">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] text-left text-sm">
                      <thead className="bg-[#fafbfa] text-xs font-medium text-[#74807b]">
                        <tr><th className="px-5 py-3">Kontonr.</th><th className="px-5 py-3">Kontonavn</th><th className="px-5 py-3">Type</th><th className="px-5 py-3 text-right">Debet</th><th className="px-5 py-3 text-right">Kredit</th><th className="px-5 py-3 text-right">Saldo</th></tr>
                      </thead>
                      <tbody className="divide-y divide-[#edf0ef]">
                        {[
                          { label: 'Drift', detail: 'Konti under 10000', rows: driftAccounts, debit: driftDebit, credit: driftCredit, color: 'bg-[#fff6e5] text-[#7b5a22]' },
                          { label: 'Balance', detail: 'Konti fra 10000', rows: balanceAccounts, debit: balanceDebit, credit: balanceCredit, color: 'bg-[#edf6f2] text-[#24664e]' },
                        ].map((section) => (
                          <Fragment key={section.label}>
                            <tr className={section.color}><td colSpan={6} className="px-5 py-2.5 text-xs font-bold uppercase tracking-[0.1em]">{section.label} <span className="ml-2 font-normal normal-case tracking-normal opacity-70">{section.detail}</span></td></tr>
                            {section.rows.map((account) => (
                              <tr key={account.number} className="text-[#44504b]">
                                <td className="px-5 py-4 font-mono text-xs text-[#68746f]">{account.number}</td>
                                <td className="px-5 py-4 font-medium text-[#24312c]">{account.name}</td>
                                <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${account.category === 'drift' ? 'bg-[#fff2d8] text-[#806024]' : 'bg-[#e6f3ed] text-[#24664e]'}`}>{account.nature}</span></td>
                                <td className="px-5 py-4 text-right tabular-nums">{money.format(account.debit)}</td>
                                <td className="px-5 py-4 text-right tabular-nums">{money.format(account.credit)}</td>
                                <td className={`px-5 py-4 text-right font-semibold tabular-nums ${account.balance < 0 ? 'text-[#a34848]' : 'text-[#196749]'}`}>{money.format(account.balance)}</td>
                              </tr>
                            ))}
                            <tr className={`border-t border-[#dfe5e2] font-semibold ${section.color}`}>
                              <td className="px-5 py-3" colSpan={3}>{section.label} i alt</td>
                              <td className="px-5 py-3 text-right tabular-nums">{money.format(section.debit)}</td>
                              <td className="px-5 py-3 text-right tabular-nums">{money.format(section.credit)}</td>
                              <td className="px-5 py-3 text-right tabular-nums">{money.format(section.debit - section.credit)}</td>
                            </tr>
                          </Fragment>
                        ))}
                      </tbody>
                      <tfoot className="border-t-2 border-[#cfd8d4] bg-[#f7f9f8] font-semibold">
                        <tr><td className="px-5 py-4" colSpan={3}>Alle konti i alt</td><td className="px-5 py-4 text-right tabular-nums">{money.format(trialTotals.debit)}</td><td className="px-5 py-4 text-right tabular-nums">{money.format(trialTotals.credit)}</td><td className={`px-5 py-4 text-right tabular-nums ${Math.abs(trialTotals.balance) < 0.005 ? 'text-[#196749]' : 'text-[#a34848]'}`}>{money.format(trialTotals.balance)}</td></tr>
                      </tfoot>
                    </table>
                  </div>
                  {!trialBalance.length && <p className="p-8 text-center text-sm text-[#74807b]">Indlæs en CSV-fil for at se saldobalancen.</p>}
                </article>
              </>
            )}

            {view === 'accountcards' && (
              <>
                <PageHeading eyebrow={`${accountCards.length} kontokort`} title="Kontokort" description="Alle posteringer pr. konto med debet, kredit og løbende saldo i datoorden." />
                {accountCards.length ? (
                  <div className="space-y-5">
                    {accountCards.map((account) => (
                      <article key={account.number} className="overflow-hidden rounded-2xl border border-[#dfe5e2] bg-white shadow-[0_1px_2px_rgb(20_40_32/3%)]">
                        <div className="flex flex-col gap-3 border-b border-[#e5eae8] p-5 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-3">
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${account.number < 10000 ? 'bg-[#fff2d8] text-[#806024]' : 'bg-[#e6f3ed] text-[#24664e]'}`}>{account.number < 10000 ? 'Drift' : 'Balance'}</span>
                            <div><h2 className="font-semibold">{account.number} {account.name}</h2><p className="mt-0.5 text-xs text-[#74807b]">{account.postings.length} {account.postings.length === 1 ? 'postering' : 'posteringer'}</p></div>
                          </div>
                          <div className="text-left sm:text-right"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#87918d]">Slutsaldo</p><p className={`mt-1 font-semibold tabular-nums ${account.closingBalance < 0 ? 'text-[#a34848]' : 'text-[#196749]'}`}>{money.format(account.closingBalance)}</p></div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[820px] table-fixed text-left text-sm">
                            <colgroup>
                              {Array.from({ length: 6 }, (_, index) => <col key={index} className="w-1/6" />)}
                            </colgroup>
                            <thead className="bg-[#fafbfa] text-xs font-medium text-[#74807b]"><tr><th className="px-5 py-3">Dato</th><th className="px-5 py-3">Bilag</th><th className="px-5 py-3">Tekst</th><th className="px-5 py-3 text-right">Debet</th><th className="px-5 py-3 text-right">Kredit</th><th className="px-5 py-3 text-right">Løbende saldo</th></tr></thead>
                            <tbody className="divide-y divide-[#edf0ef]">
                              {account.postings.map((entry) => (
                                <tr key={entry.id} className="text-[#44504b]">
                                  <td className="whitespace-nowrap px-5 py-4">{dateLabel(entry.date)}</td>
                                  <td className="px-5 py-4 font-medium text-[#568170]">[{entry.voucher}]</td>
                                  <td className="truncate px-5 py-4" title={entry.description}>{entry.description}</td>
                                  <td className="px-5 py-4 text-right tabular-nums">{entry.amount >= 0 ? money.format(entry.amount) : '—'}</td>
                                  <td className="px-5 py-4 text-right tabular-nums">{entry.amount < 0 ? money.format(Math.abs(entry.amount)) : '—'}</td>
                                  <td className={`px-5 py-4 text-right font-semibold tabular-nums ${entry.runningBalance < 0 ? 'text-[#a34848]' : 'text-[#196749]'}`}>{money.format(entry.runningBalance)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-2xl border border-[#dfe5e2] bg-white p-8 text-center text-sm text-[#74807b]">Indlæs en CSV-fil for at se kontokort.</p>
                )}
              </>
            )}

            {view === 'import' && (
              <>
                <PageHeading eyebrow="CSV-kontrol" title="Importér regnskabsdata" description="Slip filer her, eller vælg flere CSV-filer på én gang." />
                <EmptyImport isDragging={isDragging} setIsDragging={setIsDragging} handleDrop={handleDrop} onPick={() => inputRef.current?.click()} onLoadTest={loadTestFile} compact />

                {!!files.length && <article className="mt-5 rounded-2xl border border-[#dfe5e2] bg-white p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Indlæste filer</h2><button onClick={reset} className="text-xs font-semibold text-[#a34848] hover:underline">Ryd regnskab</button></div><div className="space-y-2">{files.map((file) => <div key={file.name} className="flex items-center gap-3 rounded-xl bg-[#f7f9f8] px-4 py-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-xs font-bold text-[#568170]">CSV</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{file.name}</p><p className="text-xs text-[#74807b]">{file.rows} gyldige linjer</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${file.issues ? 'bg-[#fbe9e7] text-[#a34848]' : 'bg-[#e8f5ef] text-[#196749]'}`}>{file.issues ? `${file.issues} fejl` : 'Gyldig'}</span></div>)}</div></article>}

                {!!allIssues.length && <article className="mt-5 rounded-2xl border border-[#efc9c4] bg-[#fffafa] p-5"><h2 className="font-semibold text-[#7e3535]">Fejl, der skal rettes</h2><p className="mt-1 text-xs text-[#98605c]">Ugyldige linjer er ikke medtaget i regnskabet.</p><div className="mt-4 space-y-2">{allIssues.map((issue, index) => <div key={`${issue.file}-${issue.line}-${index}`} className="flex gap-3 rounded-xl border border-[#f4ddda] bg-white px-4 py-3 text-sm"><span className="font-bold text-[#b54b43]">!</span><p><span className="font-medium">{issue.file}{issue.line ? ` · linje ${issue.line}` : ''}:</span> <span className="text-[#6d5755]">{issue.message}</span></p></div>)}</div></article>}
              </>
            )}
          </div>
        </section>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex overflow-x-auto border-t border-[#dfe5e2] bg-white px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 lg:hidden">
        {nav.map((item) => <button key={item.id} onClick={() => setView(item.id)} className={`min-w-[76px] flex-1 rounded-lg px-1 py-2 text-[10px] font-medium ${view === item.id ? 'bg-[#eaf3ef] text-[#165c46]' : 'text-[#68746f]'}`}><span className="mb-1 block text-xs">{item.icon}</span>{item.label}</button>)}
      </nav>

      <input ref={inputRef} type="file" accept=".csv,text/csv" multiple className="hidden" onChange={(event) => { void importFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />

      {showFormat && <FormatDialog onClose={() => setShowFormat(false)} />}
    </main>
  );
}

function Metric({ label, value, hint, tone = 'neutral' }: { label: string; value: string; hint: string; tone?: 'green' | 'red' | 'neutral' }) {
  return <article className="rounded-2xl border border-[#dfe5e2] bg-white p-5 shadow-[0_1px_2px_rgb(20_40_32/3%)]"><p className="text-xs font-medium text-[#74807b]">{label}</p><p className="mt-3 truncate text-2xl font-semibold tracking-tight">{value}</p><p className={`mt-2 text-xs ${tone === 'green' ? 'text-[#21805f]' : tone === 'red' ? 'text-[#a34848]' : 'text-[#68746f]'}`}>{hint}</p></article>;
}

function PageHeading({ eyebrow, title, description, action, onAction }: { eyebrow: string; title: string; description: string; action?: string; onAction?: () => void }) {
  return <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-sm font-medium text-[#568170]">{eyebrow}</p><h1 className="text-3xl font-semibold tracking-[-0.03em]">{title}</h1><p className="mt-2 text-sm leading-6 text-[#68746f]">{description}</p></div>{action && <button onClick={onAction} className="rounded-xl bg-[#165c46] px-5 py-3 text-sm font-semibold text-white">{action}</button>}</div>;
}

function TransactionTable({ entries, subtitle, valid, onShowAll }: { entries: Entry[]; subtitle: string; valid: boolean; onShowAll?: () => void }) {
  return <article className="overflow-hidden rounded-2xl border border-[#dfe5e2] bg-white shadow-[0_1px_2px_rgb(20_40_32/3%)]"><div className="flex flex-col gap-3 border-b border-[#e5eae8] p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">{onShowAll ? 'Seneste posteringer' : 'Alle posteringer'}</h2><p className="mt-1 text-xs text-[#74807b]">{subtitle}</p></div><div className="flex items-center gap-3"><span className={`w-fit rounded-full px-3 py-1.5 text-xs font-semibold ${valid ? 'bg-[#e8f5ef] text-[#196749]' : 'bg-[#fbe9e7] text-[#a34848]'}`}>{valid ? '✓ Regnskabet er gyldigt' : '! Kontrollér importen'}</span>{onShowAll && <button onClick={onShowAll} className="text-xs font-semibold text-[#165c46] hover:underline">Se alle</button>}</div></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-[#fafbfa] text-xs font-medium text-[#74807b]"><tr>{['Dato', 'Bilag', 'Konto', 'Tekst', 'Beløb'].map((heading) => <th key={heading} className={`px-5 py-3 ${heading === 'Beløb' ? 'text-right' : ''}`}>{heading}</th>)}</tr></thead><tbody className="divide-y divide-[#edf0ef]">{entries.map((row) => <tr key={row.id} className="text-[#44504b] transition hover:bg-[#fbfcfb]"><td className="whitespace-nowrap px-5 py-4">{dateLabel(row.date)}</td><td className="px-5 py-4">{row.voucher}</td><td className="px-5 py-4 font-medium text-[#24312c]">{row.account}</td><td className="px-5 py-4">{row.description}</td><td className={`px-5 py-4 text-right font-medium tabular-nums ${row.amount < 0 ? 'text-[#a34848]' : 'text-[#196749]'}`}>{money.format(row.amount)}</td></tr>)}</tbody></table></div>{!entries.length && <p className="p-8 text-center text-sm text-[#74807b]">Ingen posteringer matcher din søgning.</p>}</article>;
}

function TAccount({ account }: { account: { number: number; name: string; debit: Entry[]; credit: Entry[] } }) {
  const debitTotal = account.debit.reduce((sum, entry) => sum + entry.amount, 0);
  const creditTotal = account.credit.reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
  const columns = [
    { label: 'Debet', entries: account.debit, total: debitTotal },
    { label: 'Kredit', entries: account.credit, total: creditTotal },
  ];

  return (
    <article className="overflow-hidden rounded-2xl border border-[#dfe5e2] bg-white shadow-[0_1px_2px_rgb(20_40_32/3%)]">
      <div className="px-5 pb-3 pt-5 text-center">
        <h2 className="font-semibold">{account.number} {account.name}</h2>
      </div>
      <div className="mx-5 grid grid-cols-2 border-t-2 border-[#35443e]">
        {columns.map((column, index) => (
          <div key={column.label} className={`min-w-0 pt-3 ${index === 1 ? 'border-l-2 border-[#35443e] pl-4' : 'pr-4'}`}>
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[#87918d]">{column.label}</p>
            <div className="space-y-3">
              {column.entries.map((entry) => (
                <div key={entry.id} className="text-xs">
                  <div className="flex items-baseline justify-between gap-2 font-medium tabular-nums text-[#26332e]">
                    <span className="shrink-0 text-[#568170]">[{entry.voucher}]</span>
                    <span className="text-right">{money.format(Math.abs(entry.amount))}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[10px] text-[#87918d]" title={entry.description}>{entry.description}</p>
                </div>
              ))}
              {!column.entries.length && <p className="py-2 text-center text-xs text-[#b0b7b4]">—</p>}
            </div>
          </div>
        ))}
        {columns.map((column, index) => (
          <div key={`${column.label}-total`} className={`mt-4 flex justify-between gap-2 border-t border-[#dfe5e2] pb-4 pt-2 text-xs font-semibold tabular-nums ${index === 1 ? 'border-l-2 border-l-[#35443e] pl-4' : 'pr-4'}`}>
            <span>I alt</span><span>{money.format(column.total)}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function EmptyImport({ isDragging, setIsDragging, handleDrop, onPick, onLoadTest, compact = false }: { isDragging: boolean; setIsDragging: (value: boolean) => void; handleDrop: (event: DragEvent<HTMLDivElement>) => void; onPick: () => void; onLoadTest: () => void; compact?: boolean }) {
  return (
    <div onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop} className={`grid place-items-center rounded-2xl border-2 border-dashed px-6 text-center transition ${compact ? 'min-h-56' : 'min-h-80'} ${isDragging ? 'border-[#3c8269] bg-[#eaf3ef]' : 'border-[#cfd8d4] bg-white'}`}>
      <div>
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#eaf3ef] text-xl font-semibold text-[#165c46]">+</span>
        <h2 className="mt-4 font-semibold">Slip dine CSV-filer her</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#74807b]">Indlæs dine egne filer, eller prøv testregnskabet med 18 simple posteringer fordelt på drift, aktiver og passiver.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          <button onClick={onPick} className="rounded-xl bg-[#165c46] px-5 py-2.5 text-sm font-semibold text-white">Vælg filer</button>
          <button onClick={onLoadTest} className="rounded-xl border border-[#8cb4a5] bg-[#edf6f2] px-5 py-2.5 text-sm font-semibold text-[#165c46]">Indlæs testfil</button>
          <a href="test-regnskab.csv" download className="rounded-xl border border-[#d8dfdc] bg-white px-5 py-2.5 text-sm font-semibold text-[#5d6863] hover:bg-[#f7f9f8]">Download testfil</a>
        </div>
      </div>
    </div>
  );
}

function FormatDialog({ onClose }: { onClose: () => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#111916]/45 p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="format-title" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between gap-5"><div><p className="text-sm font-medium text-[#568170]">CSV-format</p><h2 id="format-title" className="mt-1 text-2xl font-semibold tracking-tight">Fem felter. Ét enkelt format.</h2></div><button onClick={onClose} aria-label="Luk" className="grid h-9 w-9 place-items-center rounded-full bg-[#f2f5f3] text-lg text-[#68746f]">×</button></div><p className="mt-4 text-sm leading-6 text-[#68746f]">Hver linje er én postering. Felterne adskilles med semikolon, og der skal ikke være en kolonneoverskrift.</p><div className="mt-5 overflow-x-auto rounded-2xl bg-[#17221e] p-4 font-mono text-xs leading-6 text-[#dcebe5]"><code>2026-01-01;1;1000 Renter;Modtagne renter;-1000<br />2026-01-01;1;10000 Bank;Modtagne renter;1000</code></div><div className="mt-5 grid gap-3 sm:grid-cols-2">{[['Dato', 'YYYY-MM-DD'], ['Bilag', 'Helt tal'], ['Konto', 'Nummer + kontonavn'], ['Beløb', 'Positivt eller negativt tal']].map(([label, value]) => <div key={label} className="rounded-xl border border-[#e3e8e6] p-3"><p className="text-xs font-semibold text-[#26332e]">{label}</p><p className="mt-1 text-xs text-[#74807b]">{value}</p></div>)}</div><p className="mt-5 rounded-xl bg-[#f6f8f7] p-4 text-xs leading-5 text-[#68746f]">Alle linjer med samme bilagsnummer skal tilsammen give 0,00 kr. Decimaler kan skrives med komma eller punktum.</p></div></div>;
}
