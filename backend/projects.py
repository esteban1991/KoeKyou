"""Proyectos locales y segmentos PCM, guardados atómicamente en SQLite.

El audio se guarda por contenido: cada bloque PCM se identifica por su SHA-256 y el cliente
solo envía los que el servidor todavía no tiene. Los proyectos comparten bloques idénticos
(duplicar no copia audio) y los que ya no usa ningún proyecto se borran al guardar.
"""
import hashlib
import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
import numpy as np
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field, ValidationError

router = APIRouter(prefix="/projects")
DATABASE = Path(os.environ.get("VOICEMASTER_DB", "/data/projects.sqlite3"))
MAX_STORAGE = 512 * 1024 * 1024
HASH = "^[0-9a-f]{64}$"

class Settings(BaseModel):
    depth: float = Field(4, ge=0, le=10)
    clarity: float = Field(3, ge=0, le=8)
    compression: float = Field(55, ge=0, le=100)
    cleanup: float = Field(25, ge=0, le=100)

    deess: float = Field(0, ge=0, le=100)
    denoise: float = Field(0, ge=0, le=100)
    leveler: float = Field(0, ge=0, le=100)
    pitch: float = Field(0, ge=-6, le=6)
    roomtail: float = Field(0, ge=0, le=100)
    ai_denoise: float = Field(0, ge=0, le=100)
    breath: float = Field(0, ge=0, le=100)
    mic: Literal["generic", "dynamic", "condenser", "usb", "lavalier", "laptop"] = "generic"
    loudness: Literal["off", "-14", "-16", "-19"] = "-16"

class EffectLayer(BaseModel):
    id: str = Field(max_length=100)
    name: str = Field(max_length=100)
    preset: Literal["podcast", "room", "outdoor", "cathedral", "announcer"]
    enabled: bool = True
    settings: Settings = Field(default_factory=Settings)

class Track(BaseModel):
    laneId: str = Field("primary", max_length=100)
    id: str = Field(max_length=100)
    name: str = Field(min_length=1, max_length=250)
    gain: float = Field(0, ge=-60, le=12)
    offset: float = Field(0, ge=0, le=900)
    muted: bool = False
    processed: bool = False
    sourceDescription: str = Field("", max_length=180)
    effects: list[EffectLayer] = Field(default_factory=list, max_length=6)
    renderedEffects: str = Field("", max_length=100000)
    hash: str = Field(pattern=HASH)
    originalHash: str = Field("", pattern="^([0-9a-f]{64})?$")
    originalFrames: int = Field(0, ge=0, le=48000*924)
    originalChannels: int = Field(0, ge=0, le=2)
    channels: int = Field(ge=1, le=2)
    frames: int = Field(ge=1, le=48000 * 924)
    sampleRate: Literal[48000] = 48000

class Project(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    settings: Settings = Field(default_factory=Settings)
    preset: Literal["podcast", "room", "outdoor", "cathedral", "announcer"] = "podcast"
    tracks: list[Track] = Field(default_factory=list, max_length=16)

def digest(pcm):
    return hashlib.sha256(pcm).hexdigest()

def migrate(db):
    """Convierte la tabla antigua `tracks` (audio por posición) en bloques por contenido."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tracks'").fetchone():
        return
    with db:
        for identifier, raw in db.execute("SELECT id,state FROM projects").fetchall():
            state = json.loads(raw)
            for index, track in enumerate(state.get("tracks", [])):
                for position, key in ((index, "hash"), (index + 1000, "originalHash")):
                    row = db.execute("SELECT pcm FROM tracks WHERE project_id=? AND position=?",
                                     (identifier, position)).fetchone()
                    if row is None:
                        continue
                    track[key] = digest(row[0])
                    db.execute("INSERT OR IGNORE INTO blobs VALUES(?,?)", (track[key], row[0]))
                    db.execute("INSERT OR IGNORE INTO project_blobs VALUES(?,?)", (identifier, track[key]))
            db.execute("UPDATE projects SET state=? WHERE id=?", (json.dumps(state), identifier))
        db.execute("DROP TABLE tracks")

@contextmanager
def database():
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE, timeout=30)
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, state TEXT NOT NULL, updated TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY, pcm BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS project_blobs (
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            hash TEXT NOT NULL REFERENCES blobs(hash),
            PRIMARY KEY (project_id, hash)
        );
    """)
    migrate(connection)
    try:
        with connection:
            yield connection
    finally:
        connection.close()

def project_id(value):
    try:
        return str(uuid.UUID(value))
    except ValueError as exc:
        raise HTTPException(422, "Identificador de proyecto inválido.") from exc

@router.get("")
def list_projects():
    with database() as db:
        return [{"id": row[0], "name": row[1], "updated": row[2]}
                for row in db.execute("SELECT id,name,updated FROM projects ORDER BY updated DESC")]

@router.get("/{identifier}")
def load_project(identifier: str):
    identifier = project_id(identifier)
    with database() as db:
        row = db.execute("SELECT state,updated FROM projects WHERE id=?", (identifier,)).fetchone()
        if row is None:
            raise HTTPException(404, "No se encontró el proyecto.")
        return {"id": identifier, "updated": row[1], **json.loads(row[0])}

@router.get("/{identifier}/blobs/{key}")
def load_blob(identifier: str, key: str):
    with database() as db:
        row = db.execute("SELECT b.pcm FROM project_blobs r JOIN blobs b ON b.hash=r.hash "
                         "WHERE r.project_id=? AND r.hash=?", (project_id(identifier), key)).fetchone()
        if row is None:
            raise HTTPException(404, "No se encontró el segmento.")
        return Response(row[0], media_type="application/octet-stream")

@router.put("/{identifier}")
def save_project(identifier: str, manifest: str = Form(...),
                 blobs: list[UploadFile] = File(default=[])):
    """Guarda el manifiesto; `blobs` lleva solo el PCM nuevo, con su hash como nombre de archivo.

    Si el servidor no tiene un bloque que el manifiesto usa, responde 409 con la lista
    `missing` para que el cliente lo reenvíe.
    """
    identifier = project_id(identifier)
    try:
        if len(manifest) > 100_000:
            raise HTTPException(413, "Los metadatos son demasiado grandes.")
        try:
            state = Project.model_validate_json(manifest)
        except ValidationError as exc:
            raise HTTPException(422, "Los datos del proyecto no son válidos.") from exc
        total = sum((t.channels * t.frames + t.originalChannels*t.originalFrames) * 4 for t in state.tracks)
        if total > MAX_STORAGE:
            raise HTTPException(413, "El proyecto supera los 512 MB de audio PCM.")
        # Tamaño que debe tener cada bloque según los segmentos que lo usan.
        expected = {}
        for track in state.tracks:
            needs = [(track.hash, track.channels * track.frames * 4)]
            if track.originalFrames:
                if track.originalChannels not in (1, 2) or not track.originalHash:
                    raise HTTPException(422, "Fuente original inválida.")
                needs.append((track.originalHash, track.originalChannels * track.originalFrames * 4))
            for key, size in needs:
                if expected.setdefault(key, size) != size:
                    raise HTTPException(422, "Un segmento contiene datos PCM inválidos.")
        uploaded = {}
        for upload in blobs:
            key = upload.filename or ""
            if key not in expected:
                raise HTTPException(422, "Se envió audio que el proyecto no usa.")
            pcm = upload.file.read(expected[key] + 1)
            if (len(pcm) != expected[key] or digest(pcm) != key
                    or not np.isfinite(np.frombuffer(pcm, dtype="<f4")).all()):
                raise HTTPException(422, "Un segmento contiene datos PCM inválidos.")
            uploaded[key] = pcm
        updated = datetime.now(timezone.utc).isoformat()
        with database() as db:
            marks = ",".join("?" * len(expected))
            stored = {row[0] for row in db.execute(f"SELECT hash FROM blobs WHERE hash IN ({marks})", list(expected))} if expected else set()
            missing = sorted(set(expected) - stored - set(uploaded))
            if missing:
                raise HTTPException(409, {"message": "Faltan segmentos de audio.", "missing": missing})
            db.executemany("INSERT OR IGNORE INTO blobs VALUES(?,?)", uploaded.items())
            db.execute(
                "INSERT INTO projects(id,name,state,updated) VALUES(?,?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET name=excluded.name,state=excluded.state,updated=excluded.updated",
                (identifier, state.name, state.model_dump_json(), updated),
            )
            db.execute("DELETE FROM project_blobs WHERE project_id=?", (identifier,))
            db.executemany("INSERT INTO project_blobs VALUES(?,?)", [(identifier, key) for key in expected])
            db.execute("DELETE FROM blobs WHERE hash NOT IN (SELECT hash FROM project_blobs)")
        return {"id": identifier, "name": state.name, "updated": updated, "uploaded": len(uploaded)}
    finally:
        for upload in blobs:
            upload.file.close()

@router.post("/{identifier}/duplicate")
def duplicate_project(identifier: str):
    identifier = project_id(identifier)
    duplicate = str(uuid.uuid4())
    with database() as db:
        row = db.execute("SELECT state FROM projects WHERE id=?", (identifier,)).fetchone()
        if row is None:
            raise HTTPException(404, "No se encontró el proyecto.")
        state = json.loads(row[0])
        state["name"] = state["name"][:140] + " · copia"
        updated = datetime.now(timezone.utc).isoformat()
        db.execute("INSERT INTO projects VALUES(?,?,?,?)",
                   (duplicate, state["name"], json.dumps(state), updated))
        # Los bloques se comparten: duplicar no copia audio.
        db.execute("INSERT INTO project_blobs SELECT ?,hash FROM project_blobs WHERE project_id=?",
                   (duplicate, identifier))
    return {"id": duplicate, "name": state["name"], "updated": updated}
