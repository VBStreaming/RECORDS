import os
from collections.abc import Generator

import pytest
from sqlalchemy import Connection
from sqlalchemy.orm import Session

os.environ.setdefault("JWT_SECRET_KEY", "test-only-secret-key-with-32-bytes!!")
os.environ["AI_EXTRACTION_ENABLED"] = "false"

from app.db import engine


@pytest.fixture
def db_connection() -> Generator[Connection]:
    with engine.connect() as connection:
        transaction = connection.begin()
        yield connection
        transaction.rollback()


@pytest.fixture
def db_session(db_connection: Connection) -> Generator[Session]:
    session = Session(bind=db_connection, join_transaction_mode="create_savepoint")
    yield session
    session.close()
