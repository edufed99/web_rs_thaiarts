# Security review notes

Review date: 2026-08-13

The production frontend build completed successfully. `npm audit --omit=dev`
reported two high-severity dependency findings in the current Next.js 14.2.35
dependency chain (`next` and transitive `postcss`). The automated fix proposes
a major-version upgrade, so it was not applied automatically because that can
change runtime behavior and requires regression testing.

Before exposing the application to untrusted/public networks:

1. Plan and test an upgrade to a currently supported Next.js release that
   resolves the reported advisories.
2. Repeat `npm audit --omit=dev`, production build, authentication, upload,
   recommendation, and administrator regression tests.
3. Keep ports 3000, 8001, and 5432 bound to localhost. Publish only HTTPS
   through the approved IIS reverse proxy/WAF and apply request-size/rate limits.
4. Run both application processes with a dedicated low-privilege service
   account and restrict NTFS access to `.env`, secrets, uploads, and logs.

No real `.env`, OAuth token/client JSON, API key, database password, private
key, Git history, test cache, or development log is included in the archive.

