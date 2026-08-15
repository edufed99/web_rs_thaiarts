Do not place real secrets in a deployment ZIP or source-control repository.

If file-based Google OAuth clients are approved for this server, place them
in backend/data/secrets after extraction and restrict NTFS permissions to the
dedicated service account and administrators. Prefer the organization's
approved secret manager or environment injection for production.

