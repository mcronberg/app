'use client';

import { DragEvent, useMemo, useRef, useState } from 'react';

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
type View = 'overview' | 'transactions' | 'accounts' | 'import';

const sampleEntries: Entry[] = [
  { id: 'sample-1', file: 'test1.csv', line: 1, date: '2026-01-01', voucher: '1', accountNumber: 1000, account: '1000 Renter', description: 'Modtagne renter', amount: -1000 },
  { id: 'sample-2', file: 'test1.csv', line: 2, date: '2026-01-01', voucher: '1', accountNumber: 10000, account: '10000 Bank', description: 'Modtagne renter', amount: 1000 },
];

const money = new Intl.NumberFormat('da-DK', {
  style: 'currency',
  currency: 'DKK',
  minimumFractionDigits: 2,
});

const nav: { id: View; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overblik', icon: '●' },
  { id: 'transactions', label: 'Posteringer', icon: '↕' },
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
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
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
      account,
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
  return new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(`${value}T00:00:00`));
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>('overview');
  const [entries, setEntries] = useState<Entry[]>(sampleEntries);
  const [files, setFiles] = useState<ImportedFile[]>([{ name: 'test1.csv', rows: 2, issues: 0 }]);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showFormat, setShowFormat] = useState(false);
  const [query, setQuery] = useState('');

  const voucherIssues = useMemo(() => {
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
    const balances = new Map<string, { number: number; name: string; count: number; balance: number }>();
    entries.forEach((entry) => {
      const current = balances.get(entry.account) ?? { number: entry.accountNumber, name: entry.account.replace(/^\d+\s+/, ''), count: 0, balance: 0 };
      current.count += 1;
      current.balance += entry.amount;
      balances.set(entry.account, current);
    });
    return [...balances.values()].sort((a, b) => a.number - b.number);
  }, [entries]);

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
                    <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">Dit regnskab, uden støj.</h1>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-[#68746f]">Indlæs en eller flere CSV-filer, kontrollér posteringerne og få et enkelt overblik.</p>
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
                  <EmptyImport isDragging={isDragging} setIsDragging={setIsDragging} handleDrop={handleDrop} onPick={() => inputRef.current?.click()} />
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

            {view === 'import' && (
              <>
                <PageHeading eyebrow="CSV-kontrol" title="Importér regnskabsdata" description="Slip filer her, eller vælg flere CSV-filer på én gang." />
                <EmptyImport isDragging={isDragging} setIsDragging={setIsDragging} handleDrop={handleDrop} onPick={() => inputRef.current?.click()} compact />

                {!!files.length && <article className="mt-5 rounded-2xl border border-[#dfe5e2] bg-white p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Indlæste filer</h2><button onClick={reset} className="text-xs font-semibold text-[#a34848] hover:underline">Ryd regnskab</button></div><div className="space-y-2">{files.map((file) => <div key={file.name} className="flex items-center gap-3 rounded-xl bg-[#f7f9f8] px-4 py-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-xs font-bold text-[#568170]">CSV</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{file.name}</p><p className="text-xs text-[#74807b]">{file.rows} gyldige linjer</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${file.issues ? 'bg-[#fbe9e7] text-[#a34848]' : 'bg-[#e8f5ef] text-[#196749]'}`}>{file.issues ? `${file.issues} fejl` : 'Gyldig'}</span></div>)}</div></article>}

                {!!allIssues.length && <article className="mt-5 rounded-2xl border border-[#efc9c4] bg-[#fffafa] p-5"><h2 className="font-semibold text-[#7e3535]">Fejl, der skal rettes</h2><p className="mt-1 text-xs text-[#98605c]">Ugyldige linjer er ikke medtaget i regnskabet.</p><div className="mt-4 space-y-2">{allIssues.map((issue, index) => <div key={`${issue.file}-${issue.line}-${index}`} className="flex gap-3 rounded-xl border border-[#f4ddda] bg-white px-4 py-3 text-sm"><span className="font-bold text-[#b54b43]">!</span><p><span className="font-medium">{issue.file}{issue.line ? ` · linje ${issue.line}` : ''}:</span> <span className="text-[#6d5755]">{issue.message}</span></p></div>)}</div></article>}
              </>
            )}
          </div>
        </section>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-[#dfe5e2] bg-white px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 lg:hidden">
        {nav.map((item) => <button key={item.id} onClick={() => setView(item.id)} className={`rounded-lg py-2 text-[11px] font-medium ${view === item.id ? 'bg-[#eaf3ef] text-[#165c46]' : 'text-[#68746f]'}`}><span className="mb-1 block text-xs">{item.icon}</span>{item.label}</button>)}
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

function EmptyImport({ isDragging, setIsDragging, handleDrop, onPick, compact = false }: { isDragging: boolean; setIsDragging: (value: boolean) => void; handleDrop: (event: DragEvent<HTMLDivElement>) => void; onPick: () => void; compact?: boolean }) {
  return <div onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop} className={`grid place-items-center rounded-2xl border-2 border-dashed px-6 text-center transition ${compact ? 'min-h-48' : 'min-h-72'} ${isDragging ? 'border-[#3c8269] bg-[#eaf3ef]' : 'border-[#cfd8d4] bg-white'}`}><div><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#eaf3ef] text-xl font-semibold text-[#165c46]">+</span><h2 className="mt-4 font-semibold">Slip dine CSV-filer her</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#74807b]">Du kan indlæse én eller flere semikolon-separerede filer. De bliver kontrolleret med det samme.</p><button onClick={onPick} className="mt-4 rounded-xl bg-[#165c46] px-5 py-2.5 text-sm font-semibold text-white">Vælg filer</button></div></div>;
}

function FormatDialog({ onClose }: { onClose: () => void }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#111916]/45 p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="format-title" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl sm:p-8"><div className="flex items-start justify-between gap-5"><div><p className="text-sm font-medium text-[#568170]">CSV-format</p><h2 id="format-title" className="mt-1 text-2xl font-semibold tracking-tight">Fem felter. Ét enkelt format.</h2></div><button onClick={onClose} aria-label="Luk" className="grid h-9 w-9 place-items-center rounded-full bg-[#f2f5f3] text-lg text-[#68746f]">×</button></div><p className="mt-4 text-sm leading-6 text-[#68746f]">Hver linje er én postering. Felterne adskilles med semikolon, og der skal ikke være en kolonneoverskrift.</p><div className="mt-5 overflow-x-auto rounded-2xl bg-[#17221e] p-4 font-mono text-xs leading-6 text-[#dcebe5]"><code>2026-01-01;1;1000 Renter;Modtagne renter;-1000<br />2026-01-01;1;10000 Bank;Modtagne renter;1000</code></div><div className="mt-5 grid gap-3 sm:grid-cols-2">{[['Dato', 'YYYY-MM-DD'], ['Bilag', 'Helt tal'], ['Konto', 'Nummer + kontonavn'], ['Beløb', 'Positivt eller negativt tal']].map(([label, value]) => <div key={label} className="rounded-xl border border-[#e3e8e6] p-3"><p className="text-xs font-semibold text-[#26332e]">{label}</p><p className="mt-1 text-xs text-[#74807b]">{value}</p></div>)}</div><p className="mt-5 rounded-xl bg-[#f6f8f7] p-4 text-xs leading-5 text-[#68746f]">Alle linjer med samme bilagsnummer skal tilsammen give 0,00 kr. Decimaler kan skrives med komma eller punktum.</p></div></div>;
}
