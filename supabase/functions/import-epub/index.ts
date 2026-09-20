import { createClient } from "@supabase/supabase-js";

import { handleRequest } from "./handler.ts";
import { ImportError } from "./lib/errors.ts";
import { createNemotronClient } from "./lib/nemotron.ts";
import { createSupabaseStore } from "./lib/store.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const llm = createNemotronClient({
  apiKey: Deno.env.get("NVIDIA_API_KEY"),
  model: Deno.env.get("NVIDIA_NEMOTRON_MODEL"),
  baseUrl: Deno.env.get("NVIDIA_BASE_URL"),
});

Deno.serve((req) =>
  handleRequest(req, {
    llm,
    waitUntil: (promise) => {
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(promise);
      else promise.catch(() => {});
    },
    log: (event, data) => console.log(`[import-epub] ${event}`, JSON.stringify(data)),

    async authenticate(request) {
      const header = request.headers.get("authorization") ?? "";
      const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
      const url = Deno.env.get("SUPABASE_URL");
      const key = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
      if (!token || !url || !key) throw new ImportError("unauthorized", "Unauthorized");

      // The student's own token, so row-level security scopes every query.
      const db = createClient(url, key, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await db.auth.getClaims(token);
      const userId = data?.claims?.sub;
      if (error || !userId) throw new ImportError("unauthorized", "Unauthorized");
      return { userId, store: createSupabaseStore(db, userId) };
    },
  }),
);
