// Guest mode: the student can use Syllo without an account, with everything
// they enter kept in this browser only. The flag lives in localStorage so the
// choice survives a refresh, and a custom event lets the UI react instantly.
import { useSyncExternalStore } from "react";

const FLAG_KEY = "syllo.guest-mode";
const CHANGE_EVENT = "syllo:guest-mode";

export function isGuestMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(FLAG_KEY) === "on";
  } catch {
    return false;
  }
}

export function setGuestMode(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) window.localStorage.setItem(FLAG_KEY, "on");
    else window.localStorage.removeItem(FLAG_KEY);
  } catch {
    // A browser with storage blocked simply cannot offer guest mode.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Reactive read of the guest flag, safe during server rendering. */
export function useGuestMode(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isGuestMode(),
    () => false,
  );
}
