# 곌린더

FastAPI API and responsive React web client for the 곌린더 assignment manager.

## Documentation

- [Backend development workflow](docs/development-workflow.md)
- [Implementation roadmap](docs/implementation-roadmap.md)
- [Common API response and exception contract](docs/api-response.md)
- [Authentication contract](docs/authentication.md)
- [Assignment API and data contract](docs/assignments.md)
- [Photo assignment extraction contract](docs/photo-extraction.md)
- [Web client and API connection](docs/web-client.md)
- [Developer handoff and current issues](docs/developer-handoff.md)
- [Local setup for a new developer](docs/local-setup.md)
- [Agent development rules](AGENTS.md)

## Requirements

- Python 3.14 available as `python3.14`
- Node.js 22 and npm
- Docker with Docker Compose
- GNU Make

## Local setup

For a clean machine, follow the complete [local setup guide](docs/local-setup.md).

```bash
make venv
make db-up
make check
make dev
```

The API documentation is available at <http://127.0.0.1:8000/docs>.

In another terminal, start the web client:

```bash
make web-install
make web-dev
```

Open <http://127.0.0.1:5173>. Vite proxies `/api` to the local FastAPI server,
so local development does not require CORS configuration.

Use `make db-down` to stop PostgreSQL. Local settings can be overridden in a
git-ignored `.env` copied from `.env.example`.

## Health checks

- `GET /health/live` checks that the API process is running.
- `GET /health/ready` checks that PostgreSQL accepts a query.

## MVP API

- `POST /auth/signup`, `POST /auth/login`, `GET /users/me`
- `POST /assignments`, `GET /assignments`, `GET /assignments/{assignment_id}`
- `PATCH /assignments/{assignment_id}`, `PUT /assignments/{assignment_id}/completion`
- `DELETE /assignments/{assignment_id}`, `GET /dashboard`
- `POST /assignment-extractions`

Assignment requests require the bearer access token returned by login. See the
[assignment contract](docs/assignments.md) for request fields and date rules.
Photo extraction is disabled by default and requires the settings documented in
[the extraction contract](docs/photo-extraction.md).

## Common commands

```bash
make migrate
make migration name=create_users
make lint
make format
make test
make web-check
```
