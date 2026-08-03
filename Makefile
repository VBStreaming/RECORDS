PYTHON ?= /opt/homebrew/bin/python3.14
VENV := .venv

.PHONY: venv dev test lint format check lock

venv:
	$(PYTHON) -m venv $(VENV)
	$(VENV)/bin/python -m pip install --upgrade pip
	$(VENV)/bin/python -m pip install -r requirements.lock

dev:
	$(VENV)/bin/uvicorn app.main:app --reload

test:
	$(VENV)/bin/pytest

lint:
	$(VENV)/bin/ruff check .

format:
	$(VENV)/bin/ruff format .

check: lint test

lock:
	$(VENV)/bin/python -m pip install -r requirements.in
	$(VENV)/bin/python -m pip freeze > requirements.lock
