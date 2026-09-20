# Vibrant glass refresh

## Goal
Make Syllo feel fuller, more colorful, and more alive while preserving every existing workflow and all real student data.

## What will change
- Refresh the shared app shell with translucent layered surfaces, richer navigation states, colorful icons, and a more dimensional header.
- Enrich the dashboard with distinct color treatments for focus, today, upcoming, weekly, and course sections without adding fake metrics or content.
- Add restrained motion: staggered page entrance, hover lift, active navigation movement, subtle status pulses, and small icon motion.
- Keep the existing course-based color coding and extend it consistently across cards and deadline rows.
- Improve visual density through spacing, section hierarchy, and background texture rather than adding new features.

## Technical details
- Extend semantic design tokens and reusable animation utilities in the global stylesheet.
- Update the shared shell, sidebar navigation, page heading treatment, panel surface, and dashboard presentation only.
- Respect `prefers-reduced-motion`, preserve mobile behavior, and keep all buttons and navigation accessible.
- Do not change the database, import pipeline, academic logic, or existing data-fetching behavior.

## Verification
- Check the dashboard and Import Semester page at desktop and phone sizes.
- Confirm navigation, item details, buttons, empty states, and course colors still work.
- Check current build and browser errors before completion.
