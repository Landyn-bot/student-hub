# Syllo onboarding flow

## What will be built
- Add a focused, three-step onboarding page after account creation or first sign-in.
- Collect the student's school, semester name and dates, plus a few practical planning preferences.
- Show progress, validation, back/continue controls, and a final confirmation before entering the dashboard.
- Keep the flow responsive and aligned with Syllo's existing clay-planner visual style.

## Data and privacy
- Extend each private profile with onboarding completion and planning preferences.
- Save one user-entered current semester in the existing terms collection.
- Keep all data owned by the signed-in user under the existing access controls.
- Do not create courses, assignments, events, or any other sample academic records.

## App behavior
- Send authenticated users who have not completed setup to onboarding.
- Prevent completed users from being trapped in onboarding and send them to the dashboard.
- Let users update the same school and planning preferences later from Settings.
- Update the dashboard label to reflect the saved current semester while retaining empty states until real course data exists.

## Validation and verification
- Validate all inputs in the browser and again before saving.
- Verify first-time setup, return visits, Settings edits, phone layout, and a clean app build.

## Technical details
- Add one Lovable Cloud migration with constrained preference fields and timestamps.
- Add authenticated server functions for onboarding status, current semester, setup completion, and preference updates.
- Add a protected `/onboarding` route and integrate the setup check into the authenticated app layout.
