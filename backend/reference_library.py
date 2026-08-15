"""
reference_library.py — Índice de tracks de referencia permanentes.

El usuario pone sus WAV/MP3/FLAC en la carpeta REFERENCE_LIBRARY_DIR
y este módulo los indexa automáticamente. El índice se guarda en
reference_library_index.json junto a la carpeta y se actualiza:
  - Al arrancar el servidor (scan completo).
  - Cada vez que watchdog detecta un cambio en la carpeta (add/remove/modify).
  - Manualmente vía /reference-library/rescan.

Cada entrada del índice contiene:
  {
    "id":       "<sha1 del path relativo — estable si no se mueve el archivo>",
    "filename": "Track - Artist.wav",
    "path":     "/abs/path/to/file",
    "size_mb":  12.4,
    "duration_sec": 213.5,
    "lufs":     -9.2,
    "peak_db":  -0.3,
    "sr":       44100,
    "channels": 2,
    "indexed_at": "2025-07-24T23:31:00",
  }

Análisis de LUFS/peak se hace con soundfile + pyloudnorm para no depender
de librosa en el hot-path del indexado (más rápido, menos RAM).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from datetime import datetime
from typing import Dict, List, Optional

import numpy as np
import soundfile as sf

logger = logging.getLogger(__name__)

ALLOWED = {".wav", ".mp3", ".flac", ".ogg", ".aiff", ".aif"}
INDEX_FILENAME = "reference_library_index.json"

# ── Singleton en memoria ──────────────────────────────────────────────────────
_index: Dict[str, dict] = {}       # id → entry
_index_lock = threading.Lock()
_library_dir: str = ""
_index_path: str = ""
_watcher_thread: Optional[threading.Thread] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _file_id(rel_path: str) -> str:
    """ID estable basado en sha1 del path relativo dentro de la carpeta."""
    return hashlib.sha1(rel_path.encode()).hexdigest()[:12]


def _analyze_file(path: str) -> Optional[dict]:
    """Lee metadatos y LUFS de un archivo de audio. Retorna None si falla."""
    try:
        info = sf.info(path)
        duration = info.frames / info.samplerate if info.samplerate else 0.0

        # Leer audio para LUFS/peak — limitamos a 3 minutos para que sea rápido
        max_frames = min(info.frames, int(info.samplerate * 180))
        audio, sr = sf.read(path, frames=max_frames, dtype="float32", always_2d=True)
        audio = audio.T  # (channels, samples)

        peak_db = float(20 * np.log10(np.max(np.abs(audio)) + 1e-9))

        try:
            import pyloudnorm as pyln
            meter = pyln.Meter(sr)
            mono = audio.mean(axis=0) if audio.shape[0] > 1 else audio[0]
            lufs = float(meter.integrated_loudness(mono))
            if not np.isfinite(lufs):
                lufs = float(20 * np.log10(np.sqrt(np.mean(mono**2)) + 1e-9)) - 0.691
        except Exception:
            mono = audio.mean(axis=0) if audio.shape[0] > 1 else audio[0]
            lufs = float(20 * np.log10(np.sqrt(np.mean(mono**2)) + 1e-9)) - 0.691

        return {
            "filename": os.path.basename(path),
            "path": os.path.abspath(path),
            "size_mb": round(os.path.getsize(path) / 1024 / 1024, 2),
            "duration_sec": round(duration, 2),
            "lufs": round(lufs, 1),
            "peak_db": round(peak_db, 1),
            "sr": info.samplerate,
            "channels": info.channels,
            "indexed_at": datetime.now().isoformat(timespec="seconds"),
        }
    except Exception as e:
        logger.warning(f"reference_library: error analizando {path}: {e}")
        return None


def _save_index() -> None:
    try:
        tmp = _index_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_index, f, ensure_ascii=False, indent=2)
        os.replace(tmp, _index_path)
    except Exception as e:
        logger.error(f"reference_library: error guardando índice: {e}")


def _load_index() -> None:
    global _index
    if not os.path.exists(_index_path):
        return
    try:
        with open(_index_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        with _index_lock:
            _index = data
    except Exception as e:
        logger.warning(f"reference_library: índice corrupto, se reconstruye: {e}")


# ── Scan ──────────────────────────────────────────────────────────────────────

def scan(force: bool = False) -> int:
    """Escanea la carpeta y actualiza el índice. Retorna cantidad de entradas."""
    if not _library_dir or not os.path.isdir(_library_dir):
        return 0

    found_ids = set()
    changed = False

    for fname in sorted(os.listdir(_library_dir)):
        ext = os.path.splitext(fname)[1].lower()
        if ext not in ALLOWED:
            continue
        fpath = os.path.join(_library_dir, fname)
        fid = _file_id(fname)
        found_ids.add(fid)

        with _index_lock:
            existing = _index.get(fid)

        mtime = os.path.getmtime(fpath)
        needs_analysis = (
            force
            or existing is None
            or existing.get("path") != os.path.abspath(fpath)
            or abs(existing.get("_mtime", 0) - mtime) > 1.0
        )

        if needs_analysis:
            entry = _analyze_file(fpath)
            if entry:
                entry["id"] = fid
                entry["_mtime"] = mtime
                with _index_lock:
                    _index[fid] = entry
                changed = True
                logger.info(f"reference_library: indexado {fname} (LUFS {entry['lufs']})")

    # Eliminar entradas de archivos que ya no existen
    with _index_lock:
        stale = [fid for fid in list(_index.keys()) if fid not in found_ids]
        for fid in stale:
            del _index[fid]
            changed = True

    if changed:
        _save_index()

    return len(_index)


# ── Watcher (polling liviano, no requiere inotify ni watchdog) ────────────────

def _watch_loop(interval: float = 3.0) -> None:
    """Hilo daemon que detecta cambios en la carpeta cada `interval` segundos."""
    last_snapshot: dict[str, float] = {}

    while True:
        time.sleep(interval)
        if not _library_dir or not os.path.isdir(_library_dir):
            continue
        try:
            current: dict[str, float] = {}
            for fname in os.listdir(_library_dir):
                ext = os.path.splitext(fname)[1].lower()
                if ext not in ALLOWED:
                    continue
                fpath = os.path.join(_library_dir, fname)
                try:
                    current[fname] = os.path.getmtime(fpath)
                except OSError:
                    pass

            if current != last_snapshot:
                logger.info("reference_library: cambio detectado, re-escaneando…")
                scan()
                last_snapshot = current
        except Exception as e:
            logger.warning(f"reference_library watcher error: {e}")


# ── API pública ───────────────────────────────────────────────────────────────

def init(library_dir: str) -> None:
    """Inicializar el módulo: cargar índice existente, escanear y arrancar watcher."""
    global _library_dir, _index_path, _watcher_thread
    _library_dir = os.path.abspath(library_dir)
    _index_path = os.path.join(_library_dir, INDEX_FILENAME)
    os.makedirs(_library_dir, exist_ok=True)

    _load_index()
    n = scan()
    logger.info(f"reference_library: {n} referencias en '{_library_dir}'")

    if _watcher_thread is None or not _watcher_thread.is_alive():
        _watcher_thread = threading.Thread(target=_watch_loop, daemon=True, name="ref-lib-watcher")
        _watcher_thread.start()


def list_entries() -> List[dict]:
    """Lista todas las referencias indexadas, ordenadas por nombre."""
    with _index_lock:
        entries = list(_index.values())
    # Ocultar campos internos antes de exponer al cliente
    return sorted(
        [{k: v for k, v in e.items() if not k.startswith("_")} for e in entries],
        key=lambda e: e.get("filename", "").lower(),
    )


def get_path(ref_id: str) -> Optional[str]:
    """Retorna el path absoluto de una referencia por ID, o None si no existe."""
    with _index_lock:
        entry = _index.get(ref_id)
    if not entry:
        return None
    path = entry.get("path")
    if path and os.path.exists(path):
        return path
    # Archivo movido/borrado — limpiar entrada
    with _index_lock:
        _index.pop(ref_id, None)
    _save_index()
    return None
