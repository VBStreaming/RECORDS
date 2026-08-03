# RECORDS Backend

## Local setup

```bash
make venv
make db-up
make check
make dev
```

The API documentation is available at <http://127.0.0.1:8000/docs>.

Use `make db-down` to stop PostgreSQL. Local settings can be overridden in a
git-ignored `.env` copied from `.env.example`.
