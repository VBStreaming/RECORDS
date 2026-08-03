from collections.abc import Generator

import pytest
from sqlalchemy import Connection

from app.db import engine


@pytest.fixture
def db_connection() -> Generator[Connection]:
    with engine.connect() as connection:
        transaction = connection.begin()
        yield connection
        transaction.rollback()
