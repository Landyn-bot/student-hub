import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type Profile = {
  id: string;
  full_name: string | null;
  school: string | null;
};

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Profile | null> => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("id, full_name, school")
      .eq("id", context.userId)
      .maybeSingle();

    if (error) throw error;
    return data;
  });

const profileInput = z.object({
  full_name: z.string().trim().max(120).nullable(),
  school: z.string().trim().max(160).nullable(),
});

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => profileInput.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .upsert(
        {
          id: context.userId,
          full_name: data.full_name,
          school: data.school,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

    if (error) throw error;
    return { ok: true };
  });
