PYTHON ?= python3.14
VENV := .venv
DATABASE_URL ?= postgresql+psycopg://records:records@localhost:54329/records
TEST_DATABASE_URL ?= postgresql+psycopg://records:records@localhost:54329/records_test
MOBILE_RUNTIME_TEST_PORT ?= 4174

.PHONY: venv db-up db-down dev migrate migrate-test migration test lint format check lock frontend-install frontend-dev frontend-check

venv:
	$(PYTHON) -m venv $(VENV)
	$(VENV)/bin/python -m pip install --upgrade pip
	$(VENV)/bin/python -m pip install -r requirements.lock

db-up:
	docker compose up -d --wait db

db-down:
	docker compose down

dev:
	DATABASE_URL="$(DATABASE_URL)" $(VENV)/bin/uvicorn app.main:app --reload

migrate:
	DATABASE_URL="$(DATABASE_URL)" $(VENV)/bin/alembic upgrade head

migrate-test:
	DATABASE_URL="$(TEST_DATABASE_URL)" ENVIRONMENT=test $(VENV)/bin/alembic upgrade head

migration:
	@test -n "$(name)" || (echo "name is required" && exit 1)
	DATABASE_URL="$(DATABASE_URL)" $(VENV)/bin/alembic revision --autogenerate -m "$(name)"

test:
	DATABASE_URL="$(TEST_DATABASE_URL)" $(VENV)/bin/pytest

lint:
	$(VENV)/bin/ruff check .

format:
	$(VENV)/bin/ruff format .

check: migrate migrate-test lint test

lock:
	$(VENV)/bin/python -m pip install -r requirements.in
	$(VENV)/bin/python -m pip freeze > requirements.lock

frontend-install:
	npm ci

frontend-dev:
	npm run dev

frontend-check:
	npm run check:runtime
	npx tsc --noEmit
	npm run build
	# Spring-connected scenarios stay in the full npm run test:runtime suite.
	MOBILE_RUNTIME_TEST_PORT="$(MOBILE_RUNTIME_TEST_PORT)" npx playwright test --grep-invert "responsive signup|notification preferences|cached assignments"
