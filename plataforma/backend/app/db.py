"""Base de datos local (SQLite + SQLModel). Los datos nunca salen del equipo."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

from pydantic import NaiveDatetime
from sqlalchemy import JSON, Column
from sqlmodel import Field, Session, SQLModel, create_engine, select

DATA = Path(__file__).resolve().parents[1] / "data"
DATA.mkdir(exist_ok=True)
DB_PATH = DATA / "plataforma.db"
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})


class Atleta(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    nombre: str
    deporte: str = ""
    pierna_dominante: str = "derecha"
    estatura_cm: float | None = None
    masa_kg: float | None = None
    creado: NaiveDatetime = Field(default_factory=datetime.now)


class Sesion(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    atleta_id: int = Field(foreign_key="atleta.id", index=True)
    inicio: NaiveDatetime = Field(default_factory=datetime.now)
    fin: NaiveDatetime | None = None
    fuente: str = ""
    objetivo: int = 3


class Salto(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    sesion_id: int = Field(foreign_key="sesion.id", index=True)
    atleta_id: int = Field(foreign_key="atleta.id", index=True)
    fecha: NaiveDatetime = Field(default_factory=datetime.now)
    indice: int = 0
    categoria: str = ""
    confianza: str = "alta"
    escenario: str | None = None
    resultado: dict = Field(default_factory=dict, sa_column=Column(JSON))
    serie: dict = Field(default_factory=dict, sa_column=Column(JSON))
    crudo: dict = Field(default_factory=dict, sa_column=Column(JSON))


class PruebaBanco(SQLModel, table=True):
    """Reporte de la prueba guiada del Banco de pruebas (hardware, sin atleta)."""
    id: int | None = Field(default=None, primary_key=True)
    fecha: NaiveDatetime = Field(default_factory=datetime.now)
    fuente: str = ""
    aprobado: bool = False
    notas: str = ""
    checks: list = Field(default_factory=list, sa_column=Column(JSON))
    flujo: dict = Field(default_factory=dict, sa_column=Column(JSON))


def init():
    SQLModel.metadata.create_all(engine)


def session() -> Session:
    return Session(engine)


__all__ = ["Atleta", "Sesion", "Salto", "PruebaBanco", "init", "session", "select"]
