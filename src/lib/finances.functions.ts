import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** The fixed set of spending categories offered in the UI. */
export const FINANCE_CATEGORIES = [
  "Food",
  "School",
  "Transportation",
  "Housing",
  "Entertainment",
  "Subscriptions",
  "Other",
] as const;

export type FinanceCategory = (typeof FINANCE_CATEGORIES)[number];

/** A single manually entered money movement. */
export type FinanceTransaction = {
  id: string;
  direction: "income" | "expense";
  category: string;
  description: string;
  /** ISO date (YYYY-MM-DD). */
  occurredOn: string;
  /** Positive amount in the user's currency. */
  amount: number;
  currency: string;
  createdAt: string;
};

const addTransactionSchema = z.object({
  direction: z.enum(["income", "expense"]),
  category: z.enum(FINANCE_CATEGORIES),
  description: z.string().trim().min(1, "Add a short description.").max(160),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date."),
  amount: z.number().positive("Amount must be greater than zero.").max(1_000_000),
});

const deleteTransactionSchema = z.object({ id: z.string().uuid() });

/**
 * Lists the signed-in user's own transactions, newest first.
 * Row-level security scopes every read to the authenticated user.
 */
export const listTransactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FinanceTransaction[]> => {
    const { data, error } = await context.supabase
      .from("financial_transactions")
      .select("id, direction, category, description, amount, currency, occurred_on, created_at")
      .eq("user_id", context.userId)
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => ({
      id: row.id,
      direction: row.direction === "income" ? "income" : "expense",
      category: row.category ?? "Other",
      description: row.description,
      amount: Number(row.amount),
      currency: row.currency ?? "USD",
      occurredOn: row.occurred_on,
      createdAt: row.created_at,
    }));
  });

/** Adds a manually entered income or expense row owned by the signed-in user. */
export const addTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => addTransactionSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("financial_transactions").insert({
      user_id: context.userId,
      direction: data.direction,
      category: data.category,
      description: data.description,
      occurred_on: data.occurredOn,
      amount: data.amount,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Deletes one of the signed-in user's own transactions. */
export const deleteTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => deleteTransactionSchema.parse(data))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("financial_transactions")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
