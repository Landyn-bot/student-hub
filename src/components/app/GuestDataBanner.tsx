// Shown once to a student who used Syllo without an account and then signed in:
// their browser-kept work can be moved into the account, or left where it is.
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/app-button";
import { clearGuestData, guestDataCount, readGuestData } from "@/lib/guest/store";
import { importGuestData } from "@/lib/guest-migrate.functions";

export function GuestDataBanner({ guest }: { guest: boolean }) {
  const runImport = useServerFn(importGuestData);
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Only relevant for a signed-in student who still has guest work in this browser.
  const count = guest || dismissed ? 0 : guestDataCount();
  if (count === 0) return null;

  async function move() {
    setBusy(true);
    try {
      const data = readGuestData();
      await runImport({
        data: {
          courses: data.courses.map((course) => ({
            id: course.id,
            name: course.name,
            courseCode: course.course_code,
            instructor: course.instructor,
          })),
          items: data.items.map((item) => ({
            kind: item.kind,
            type: item.type,
            title: item.title,
            description: item.description,
            courseId: item.courseId,
            date: item.date,
            time: item.time,
            done: item.done,
          })),
          transactions: data.transactions.map((row) => ({
            direction: row.direction,
            category: row.category,
            description: row.description,
            occurredOn: row.occurredOn,
            amount: row.amount,
          })),
        },
      });
      clearGuestData();
      setDismissed(true);
      await queryClient.invalidateQueries();
      toast.success("Your saved work is now in your account.");
    } catch {
      toast.error("We could not move that work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel mb-4 flex flex-wrap items-center gap-3 p-4">
      <p className="min-w-0 flex-1 text-sm text-foreground/70">
        You have {count} {count === 1 ? "thing" : "things"} saved in this browser from before you
        signed in. Move it into your account?
      </p>
      <div className="flex gap-2">
        <Button variant="accent" size="sm" loading={busy} onClick={() => void move()}>
          Move it in
        </Button>
        <Button variant="soft" size="sm" onClick={() => setDismissed(true)}>
          Not now
        </Button>
      </div>
    </div>
  );
}
