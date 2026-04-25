"""Pytest fixtures shared across all server tests.

Provides an in-memory SQLite database and a FastAPI TestClient.
This isolates tests from the dev/prod Postgres database.
"""
import os
# Set DATABASE_URL early, before importing database or main modules
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture
def test_engine():
    """In-memory SQLite engine, shared across the test session."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # Import and create models against this engine
    import models
    models.Base.metadata.create_all(bind=engine)
    yield engine
    engine.dispose()


@pytest.fixture
def db_session(test_engine):
    """A SQLAlchemy session backed by the test engine."""
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(test_engine):
    """FastAPI TestClient with database dependency overridden to use the test engine."""
    from sqlalchemy.orm import sessionmaker
    import database
    import main

    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    @contextmanager
    def override_get_background_db():
        db = TestingSessionLocal()
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    original_get_background_db = database.get_background_db
    database.get_background_db = override_get_background_db
    main.app.dependency_overrides[database.get_db] = override_get_db
    try:
        with TestClient(main.app) as c:
            yield c
    finally:
        main.app.dependency_overrides.pop(database.get_db, None)
        database.get_background_db = original_get_background_db
