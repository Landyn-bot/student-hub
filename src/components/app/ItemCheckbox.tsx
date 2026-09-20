// A small tick box for handed-in work. Quizzes, tests and exams are never checkable,
// so this renders a quiet spacer for them and keeps the rows aligned.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";

import { setAssignmentDone } from "@/lib/planner.functions";
import { cn } from "@/lib/utils";
import * as guestStore from "@/lib/guest/store";
import { useAppFn } from "@/lib/guest/use-app-fn";

export function ItemCheckbox({ id, completable }: { id: string; completable: boolean }) {
  const markDone = useAppFn(setAssignmentDone, guestStore.setAssignmentDone);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => markDone({ data: { id, done: true } }),
    onSuccess: async () => {
      // The planner and focus lists both drop the item once it is done.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["planner"] }),
        queryClient.invalidateQueries({ queryKey: ["focus"] }),
      ]);
    },
  });

  if (!completable) {
    return <span className="w-3 shrink-0" aria-hidden />;
  }

  return (
    <button
      type="button"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      aria-label="Mark as done"
      title="Mark as done"
      className={cn(
        "my-auto ml-2 grid size-5 shrink-0 place-items-center rounded-md border border-border",
        "text-transparent transition hover:border-brand hover:text-brand disabled:opacity-60",
      )}
    >
      {mutation.isPending ? (
        <Loader2 className="size-3.5 animate-spin text-foreground/50" />
      ) : (
        <Check className="size-3.5" />
      )}
    </button>
  );
}
