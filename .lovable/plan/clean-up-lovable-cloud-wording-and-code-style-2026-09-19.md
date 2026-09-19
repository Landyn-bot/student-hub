# Clean up Lovable Cloud wording and code style

## Changes
- Audit all application copy, metadata, documentation, and surfaced error messages so the product refers only to Lovable Cloud.
- Keep generated backend integration names and required package identifiers unchanged where renaming would break Lovable Cloud connectivity; these will remain internal and never appear in the website.
- Format the maintained source and configuration files with the project’s existing formatter.
- Add a small number of intent-focused comments around authentication, protected data access, and non-obvious lifecycle behavior; avoid comments that merely repeat the code.
- Standardize local syntax where needed, including imports, multiline expressions, and control-flow clarity, without changing behavior.

## Validation
- Run lint checks.
- Confirm the latest preview build reports success.
- Re-scan user-facing source and documentation for any visible backend-vendor wording.
