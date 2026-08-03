from sqlalchemy import Connection, text

from app.db import engine


def test_database_connection(db_connection: Connection) -> None:
    assert db_connection.scalar(text("SELECT 1")) == 1
    assert db_connection.in_transaction()


def test_transaction_can_be_rolled_back() -> None:
    with engine.connect() as connection:
        transaction = connection.begin()
        connection.execute(text("CREATE TABLE harness_rollback_probe (id integer)"))
        transaction.rollback()

    with engine.connect() as connection:
        table_name = connection.scalar(
            text("SELECT to_regclass('public.harness_rollback_probe')")
        )

    assert table_name is None
