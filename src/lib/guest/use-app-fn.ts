// Picks where a page's data comes from: the signed-in account (server function)
// or this browser's own guest storage. Call sites keep the same signature, so a
// page does not need to know which mode it is running in.
import { useServerFn } from "@tanstack/react-start";

import { useGuestMode } from "@/lib/guest/mode";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function useAppFn<F extends (...args: any[]) => any>(serverFn: F, localFn: unknown): F {
  const remote = useServerFn(serverFn as any);
  const guest = useGuestMode();
  return (guest ? localFn : remote) as F;
}
