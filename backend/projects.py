"""Proyectos locales y pistas PCM, guardados atómicamente en SQLite."""
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
        CREATE TABLE IF NOT EXISTS tracks (
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            position INTEGER NOT NULL, pcm BLOB NOT NULL,
            PRIMARY KEY (project_id, position)
        );
    """)
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

@router.get("/{identifier}/tracks/{index}")
def load_track(identifier: str, index: int, original: bool = False):
    with database() as db:
        row = db.execute("SELECT pcm FROM tracks WHERE project_id=? AND position=?",
                         (project_id(identifier), index + (1000 if original else 0))).fetchone()
        if row is None:
            raise HTTPException(404, "No se encontró la pista.")
        return Response(row[0], media_type="application/octet-stream")

@router.put("/{identifier}")
def save_project(identifier: str, manifest: str = Form(...),
                 audio: list[UploadFile] = File(default=[]),
                 originals: list[UploadFile] = File(default=[])):
    identifier = project_id(identifier)
    try:
        if len(manifest) > 100_000:
            raise HTTPException(413, "Los metadatos son demasiado grandes.")
        try:
            state = Project.model_validate_json(manifest)
        except ValidationError as exc:
            raise HTTPException(422, "Los datos del proyecto no son válidos.") from exc
        if len(state.tracks) != len(audio):
            raise HTTPException(422, "Faltan archivos de pistas.")
        if sum(bool(t.originalFrames) for t in state.tracks) != len(originals):
            raise HTTPException(422, "Faltan fuentes originales del proyecto.")
        total = sum((t.channels * t.frames + t.originalChannels*t.originalFrames) * 4 for t in state.tracks)
        if total > MAX_STORAGE:
            raise HTTPException(413, "El proyecto supera los 512 MB de audio PCM.")
        blobs = []
        for track, upload in zip(state.tracks, audio):
            expected = track.channels * track.frames * 4
            pcm = upload.file.read(expected + 1)
            if len(pcm) != expected or not np.isfinite(np.frombuffer(pcm, dtype="<f4")).all():
                raise HTTPException(422, "Una pista contiene datos PCM inválidos.")
            blobs.append(pcm)
        original_blobs = []
        original_iterator = iter(originals)
        for index, track in enumerate(state.tracks):
            if track.originalFrames:
                if track.originalChannels not in (1, 2):
                    raise HTTPException(422, "Canales originales inválidos.")
                expected = track.originalFrames * track.originalChannels * 4
                pcm = next(original_iterator).file.read(expected + 1)
                if len(pcm) != expected or not np.isfinite(np.frombuffer(pcm, dtype="<f4")).all():
                    raise HTTPException(422, "Fuente original inválida.")
                original_blobs.append((index + 1000, pcm))
        updated = datetime.now(timezone.utc).isoformat()
        with database() as db:
            db.execute(
                "INSERT INTO projects(id,name,state,updated) VALUES(?,?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET name=excluded.name,state=excluded.state,updated=excluded.updated",
                (identifier, state.name, state.model_dump_json(), updated),
            )
            db.execute("DELETE FROM tracks WHERE project_id=?", (identifier,))
            db.executemany("INSERT INTO tracks(project_id,position,pcm) VALUES(?,?,?)",
                           [(identifier, i, blob) for i, blob in enumerate(blobs)] +
                           [(identifier, i, blob) for i, blob in original_blobs])
        return {"id": identifier, "name": state.name, "updated": updated}
    finally:
        for upload in [*audio, *originals]:
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
        db.execute("INSERT INTO tracks SELECT ?,position,pcm FROM tracks WHERE project_id=?",
                   (duplicate, identifier))
    return {"id": duplicate, "name": state["name"], "updated": updated}
