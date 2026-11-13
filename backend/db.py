import os
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import ForeignKey, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

ROOT = Path(__file__).resolve().parent.parent
database_url = os.environ.get("DATABASE_URL")
if not database_url:
    (ROOT / "data").mkdir(exist_ok=True)
    database_url = f"sqlite:///{ROOT / 'data' / 'travel.sqlite3'}"
engine = create_engine(database_url, pool_pre_ping=True)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(70))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password: Mapped[str] = mapped_column(String(160))


class LoginSession(Base):
    __tablename__ = "login_sessions"
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    expires: Mapped[int] = mapped_column(Integer, index=True)


class FirebaseIdentity(Base):
    __tablename__ = "firebase_identities"
    uid: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), unique=True)


class Library(Base):
    __tablename__ = "libraries"
    user_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), primary_key=True)
    document: Mapped[str] = mapped_column(Text)
    revision: Mapped[int] = mapped_column(Integer, default=1)


@contextmanager
def transaction():
    with Session(engine) as session, session.begin():
        yield session
