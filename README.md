# RECORDS Backend

FastAPI backend harness for the RECORDS assignment manager.

## Requirements

- Python 3.14 at `/opt/homebrew/bin/python3.14`
- Docker with Docker Compose

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

## Health checks

- `GET /health/live` checks that the API process is running.
- `GET /health/ready` checks that PostgreSQL accepts a query.

## Common commands

```bash
make migrate
make migration name=create_users
make lint
make format
make test
```
