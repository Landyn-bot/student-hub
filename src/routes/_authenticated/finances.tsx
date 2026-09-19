import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useServerFn } from "@tanstack/react-router";
import { ArrowDownLeft, ArrowUpRight, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { PageHeader } from "@/components/app/PageHeader";
import { Button } from "@/components/ui/app-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel-surface";
import {
  FINANCE_CATEGORIES,
  addTransaction,
  deleteTransaction,
  listTransactions,
  type FinanceTransaction,
} from "@/lib/finances.functions";

export const Route = createFileRoute("/_authenticated/finances")({
  head: () => ({
    meta: [
      { title: "Finances — Syllo" },
      {
        name: "description",
        content: "Income, expenses and everyday spending in one simple ledger.",
      },
      { property: "og:title", content: "Finances — Syllo" },
      {
        property: "og:description",
        content: "Income, expenses and everyday spending in one simple ledger.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FinancesPage,
});

/** Local YYYY-MM-DD for today, used as the default date on the form. */
function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** YYYY-MM prefix for the current month, used to group "this month" totals. */
function thisMonthKey(): string {
  return todayKey().slice(0, 7);
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function FinancesPage() {
  const queryClient = useQueryClient();
  const fetchTransactions = useServerFn(listTransactions);
  const runAdd = useServerFn(addTransaction);
  const runDelete = useServerFn(deleteTransaction);

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ["finances"],
    queryFn: fetchTransactions,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["finances"] });

  const addMutation = useMutation({
    mutationFn: runAdd,
    onSuccess: refresh,
  });
  const deleteMutation = useMutation({
    mutationFn: runDelete,
    onSuccess: refresh,
  });

  // --- Form state ------------------------------------------------------------
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string>("Food");
  const [occurredOn, setOccurredOn] = useState(todayKey());
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError("Enter an amount greater than zero.");
      return;
    }
    addMutation.mutate(
      {
        data: {
          direction,
          category: category as never,
          description,
          occurredOn,
          amount: parsedAmount,
        },
      },
      {
        onSuccess: () => {
          setAmount("");
          setDescription("");
        },
        onError: (error) =>
          setFormError(error instanceof Error ? error.message : "Could not save that entry."),
      },
    );
  };

  // --- Month summary ----------------------------------------------------------
  const summary = useMemo(() => {
    const month = thisMonthKey();
    const monthRows = transactions.filter((tx) => tx.occurredOn.startsWith(month));
    const moneyIn = monthRows
      .filter((tx) => tx.direction === "income")
      .reduce((sum, tx) => sum + tx.amount, 0);
    const spent = monthRows
      .filter((tx) => tx.direction === "expense")
      .reduce((sum, tx) => sum + tx.amount, 0);
    const byCategory = new Map<string, number>();
    for (const tx of monthRows) {
      if (tx.direction !== "expense") continue;
      byCategory.set(tx.category, (byCategory.get(tx.category) ?? 0) + tx.amount);
    }
    return { moneyIn, spent, remaining: moneyIn - spent, byCategory, monthRows };
  }, [transactions]);

  const currency = transactions[0]?.currency ?? "USD";
  const monthLabel = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const maxCategory = Math.max(0, ...summary.byCategory.values());
  const recent = transactions.slice(0, 12);

  return (
    <>
      <PageHeader eyebrow="Finances" title="Money, kept next to the plan." />

      {isLoading ? (
        <Panel>
          <p className="text-sm text-muted-foreground">Loading your ledger…</p>
        </Panel>
      ) : (
        <div className="space-y-6">
          {/* Month at a glance */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Panel>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                In · {monthLabel}
              </p>
              <p className="mt-2 font-display text-2xl text-primary">
                {formatMoney(summary.moneyIn, currency)}
              </p>
            </Panel>
            <Panel>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Spent · {monthLabel}
              </p>
              <p className="mt-2 font-display text-2xl text-foreground">
                {formatMoney(summary.spent, currency)}
              </p>
            </Panel>
            <Panel>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Remaining
              </p>
              <p
                className={`mt-2 font-display text-2xl ${
                  summary.remaining < 0 ? "text-accent" : "text-foreground"
                }`}
              >
                {formatMoney(summary.remaining, currency)}
              </p>
            </Panel>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Add an entry */}
            <Panel>
              <PanelHeader
                title="Add an entry"
                aside={direction === "income" ? "Money in" : "Money out"}
              />
              <form onSubmit={submit} className="space-y-4">
                <div className="flex gap-2">
                  {(["expense", "income"] as const).map((option) => (
                    <Button
                      key={option}
                      type="button"
                      variant={direction === option ? "brand" : "soft"}
                      size="sm"
                      onClick={() => setDirection(option)}
                    >
                      {option === "expense" ? "Expense" : "Income"}
                    </Button>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span className="text-muted-foreground">Amount</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-muted-foreground">Date</span>
                    <input
                      type="date"
                      required
                      value={occurredOn}
                      onChange={(event) => setOccurredOn(event.target.value)}
                      className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                </div>
                <label className="block space-y-1 text-sm">
                  <span className="text-muted-foreground">Category</span>
                  <select
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  >
                    {FINANCE_CATEGORIES.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="text-muted-foreground">Description</span>
                  <input
                    type="text"
                    required
                    maxLength={160}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder={direction === "income" ? "Part-time job" : "Groceries"}
                    className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
                {formError ? <p className="text-sm text-accent">{formError}</p> : null}
                <Button type="submit" disabled={addMutation.isPending}>
                  {addMutation.isPending ? "Saving…" : "Add entry"}
                </Button>
              </form>
            </Panel>

            {/* Spending by category */}
            <Panel>
              <PanelHeader title={`Spending by category · ${monthLabel}`} />
              {summary.byCategory.size === 0 ? (
                <EmptyState
                  title="Nothing spent yet"
                  description="Expenses you add this month will be grouped here by category."
                />
              ) : (
                <ul className="space-y-3">
                  {[...summary.byCategory.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([name, total]) => (
                      <li key={name}>
                        <div className="flex items-baseline justify-between text-sm">
                          <span>{name}</span>
                          <span className="font-semibold">{formatMoney(total, currency)}</span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-black/5">
                          <div
                            className="h-2 rounded-full bg-primary"
                            style={{ width: `${maxCategory ? (total / maxCategory) * 100 : 0}%` }}
                          />
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </Panel>
          </div>

          {/* Recent transactions */}
          <Panel>
            <PanelHeader title="Recent transactions" aside={`${transactions.length} total`} />
            {recent.length === 0 ? (
              <EmptyState
                title="No transactions yet"
                description="Add your first income or expense above — everything stays private to your account."
              />
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((tx) => (
                  <TransactionRow
                    key={tx.id}
                    tx={tx}
                    onDelete={() => deleteMutation.mutate({ data: { id: tx.id } })}
                    deleting={deleteMutation.isPending}
                  />
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}

function TransactionRow({
  tx,
  onDelete,
  deleting,
}: {
  tx: FinanceTransaction;
  onDelete: () => void;
  deleting: boolean;
}) {
  const income = tx.direction === "income";
  return (
    <li className="flex items-center gap-3 py-3">
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
          income ? "bg-primary/10 text-primary" : "bg-accent/10 text-accent"
        }`}
      >
        {income ? <ArrowUpRight className="size-4" /> : <ArrowDownLeft className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{tx.description}</p>
        <p className="text-xs text-muted-foreground">
          {tx.category} · {formatDate(tx.occurredOn)}
        </p>
      </div>
      <p className={`text-sm font-semibold ${income ? "text-primary" : "text-foreground"}`}>
        {income ? "+" : "−"}
        {formatMoney(tx.amount, tx.currency)}
      </p>
      <button
        type="button"
        onClick={onDelete}
        disabled={deleting}
        aria-label={`Delete ${tx.description}`}
        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-black/5 hover:text-accent"
      >
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}
