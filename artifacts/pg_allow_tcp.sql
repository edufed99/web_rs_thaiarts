-- Configure Postgres for password auth from host
-- (WSL2 mirrors 127.0.0.1 to Windows host, so same host works)
SHOW config_file;
SHOW hba_file;