# Restore the public Syllo website

## Confirmed issue

The live URL returns the correct Syllo page from the server, then the browser replaces it with the generic error screen during startup. The browser console confirms that the published JavaScript bundle is missing its Lovable Cloud connection values. Lovable Cloud itself is healthy, so refreshing the page cannot solve this deployment mismatch.

## Plan

1. Refresh the published site's Lovable Cloud runtime bindings and create a fresh production deployment so the browser bundle receives the required public connection settings.
2. Verify the public home page, sign-in page, and signed-in dashboard in clean browser sessions rather than relying on an already-open preview tab.
3. Confirm the page no longer switches to the generic error screen and that authentication and planner requests reach Lovable Cloud successfully.
4. If a fresh deployment still omits the settings, add a narrow startup safeguard so public pages remain usable and show a clear recoverable connection message instead of crashing the entire site; do not modify generated integration files.
5. Recheck the production error records and project checks before declaring the issue resolved.

## Scope

No feature, database schema, EPUB pipeline, Nemotron integration, or visual redesign changes. The work is limited to restoring reliable website startup and validating the deployed result.
