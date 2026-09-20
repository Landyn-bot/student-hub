// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// These are the browser-safe Lovable Cloud connection values for this project.
// Keeping them here avoids a blank screen when a production build omits VITE_* aliases.
const cloudUrl = "https://sblxoxurojhhlzvqyhxd.supabase.co";
const cloudPublishableKey = "sb_publishable_Swn8wUGiXc-yqvXvWgtaBg_Vk931uPG";

export default defineConfig({
  vite: {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(cloudUrl),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(cloudPublishableKey),
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
