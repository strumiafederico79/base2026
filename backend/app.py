from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query, BackgroundTasks, WebSocket, WebSocketDisconnect, Depends
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from typing import Optional, List, Dict
import os, uuid, logging, time, asyncio, math, json
import librosa
import numpy as np
import soundfile as sf
from pydantic import BaseModel, Field
try:
    from .job_service import JobService
    from .audio_service import AudioService
    from .validation_utils import MAX_FILE_SIZE, coerce_ws_chain_params, validate_audio_file
    from .audio_cache import get as audio_cache_get, put as audio_cache_put
    from . import library
    from .routers import (
        create_ai_router,
        create_analysis_router,
        create_auth_router,
        create_dashboard_router,
        create_info_router,
        create_jobs_router,
        create_library_router,
        create_reference_library_router,
    )
except ImportError:  # pragma: no cover - fallback for direct script execution
    from job_service import JobService
    from audio_service import AudioService
    from validation_utils import MAX_FILE_SIZE, coerce_ws_chain_params, validate_audio_file
    from audio_cache import get as audio_cache_get, put as audio_cache_put
    import library
    from routers import (
        create_ai_router,
        create_analysis_router,
        create_auth_router,
        create_dashboard_router,
        create_info_router,
        create_jobs_router,
        create_library_router,
        create_reference_library_router,
    )
try:
    from .mastering import (
        process_audio, analyze_audio, spectrum_analysis_fft, mix_advice,
        MASTERING_PRESETS, get_preset, PLATFORM_LOUDNESS_TARGETS, get_platform_target,
        process_audio_with_reference, _crop_preview, measure_lufs_integrated,
        compute_ms_eq_curves, apply_ms_matching_fir,
        compute_lufs_corrected_gain,
        spectral_energy_at_bands, compute_reference_eq_curve, compute_reference_eq_curve_ddsp,
        build_matching_fir, apply_matching_fir, eq_high_pass, eq_parametric_band,
        spectral_energy_at_bands_multires,
        derive_mb_chain_params_from_reference,
        normalize_by_lufs,
    )
    from .streaming_engine import master_stream_to_pcm16, iter_mastering_chunks
    from .mixer import mix_and_master, StemParams, MixParams, process_stem, apply_sidechain, _ensure_stereo, _match_length
    from .stem_separation import separate_stems, separate_vocals_hq
    from .stem_analysis import analyze_stems_full
    from .system_monitor import get_system_stats
    from .pitch_correction import PitchCorrectionProcessor
    from . import ai_assistant
    from .config import UPLOAD_DIR, PROCESSED_DIR, STEMS_DIR, PROCESSED_TTL, MAX_FILE_SIZE, REFERENCE_LIBRARY_DIR, STEM_LIBRARY_DIR
    from . import reference_library as ref_lib
except ImportError:
    from mastering import (
        process_audio, analyze_audio, spectrum_analysis_fft, mix_advice,
        MASTERING_PRESETS, get_preset, PLATFORM_LOUDNESS_TARGETS, get_platform_target,
        process_audio_with_reference, _crop_preview, measure_lufs_integrated,
        compute_ms_eq_curves, apply_ms_matching_fir,
        compute_lufs_corrected_gain,
        spectral_energy_at_bands, compute_reference_eq_curve, compute_reference_eq_curve_ddsp,
        build_matching_fir, apply_matching_fir, eq_high_pass, eq_parametric_band,
        spectral_energy_at_bands_multires,
        derive_mb_chain_params_from_reference,
        normalize_by_lufs,
    )
    from streaming_engine import master_stream_to_pcm16, iter_mastering_chunks
    from mixer import mix_and_master, StemParams, MixParams, process_stem, apply_sidechain, _ensure_stereo, _match_length
    from stem_separation import separate_stems, separate_vocals_hq
    from stem_analysis import analyze_stems_full
    from system_monitor import get_system_stats
    from pitch_correction import PitchCorrectionProcessor
    import ai_assistant
    from config import UPLOAD_DIR, PROCESSED_DIR, STEMS_DIR, PROCESSED_TTL, MAX_FILE_SIZE, REFERENCE_LIBRARY_DIR, STEM_LIBRARY_DIR
    import reference_library as ref_lib
except ImportError:
    from streaming_engine import master_stream_to_pcm16, iter_mastering_chunks
    from mixer import mix_and_master, StemParams, MixParams, process_stem, apply_sidechain, _ensure_stereo, _match_length
    from stem_separation import separate_stems, separate_vocals_hq
    from stem_analysis import analyze_stems_full
    from system_monitor import get_system_stats
    from pitch_correction import PitchCorrectionProcessor
    import ai_assistant
    from config import UPLOAD_DIR, PROCESSED_DIR, STEMS_DIR, PROCESSED_TTL, MAX_FILE_SIZE, REFERENCE_LIBRARY_DIR, STEM_LIBRARY_DIR
    import reference_library as ref_lib

try:
    from .auth import (
        bootstrap_admin, get_current_user, get_admin_user,
        handle_register, handle_login, handle_me,
        handle_list_users, handle_approve_user, handle_reject_user,
        handle_delete_user, handle_change_password,
    )
except ImportError:
    from auth import (
        bootstrap_admin, get_current_user, get_admin_user,
        handle_register, handle_login, handle_me,
        handle_list_users, handle_approve_user, handle_reject_user,
        handle_delete_user, handle_change_password,
    )

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Audio Mastering API", version="7.0.0")
app.add_middleware(
    CORSMiddleware,
    # Antes: allow_origins=["*"] — con JWT de por medio, cualquier página
    # de internet podía pegarle a la API usando la sesión de un usuario
    # logueado en su browser. Ahora, con dominio fijo (HTTPS via Caddy),
    # restringido solo a ese origin.
    allow_origins=["https://masteringstudio.duckdns.org"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Crear admin si no existe
bootstrap_admin()

UPLOAD_DIR    = UPLOAD_DIR
PROCESSED_DIR = PROCESSED_DIR
STEMS_DIR     = STEMS_DIR   # subcarpeta por job_id con los 4 WAV de stems
PROCESSED_TTL  = PROCESSED_TTL

# Librería persistente de archivos originales (a diferencia de UPLOAD_DIR, NO
# tiene TTL ni se toca en cleanup_old() — vive hasta que el usuario borra un
# archivo explícitamente desde la web). Se calcula como hermano de UPLOAD_DIR
# para no requerir tocar config.py; si preferís definirlo ahí como LIBRARY_DIR
# y pisar esta línea con el import, funciona igual.
LIBRARY_DIR = os.path.join(os.path.dirname(os.path.normpath(UPLOAD_DIR)), "library")

os.makedirs(UPLOAD_DIR,    exist_ok=True)
os.makedirs(PROCESSED_DIR, exist_ok=True)
ref_lib.init(REFERENCE_LIBRARY_DIR)  # carga índice + arranca watcher
os.makedirs(STEMS_DIR,     exist_ok=True)
os.makedirs(LIBRARY_DIR,   exist_ok=True)
os.makedirs(STEM_LIBRARY_DIR, exist_ok=True)

jobs = JobService()
audio_service = AudioService(upload_dir=UPLOAD_DIR)

def sanitize_track_name(name: Optional[str], fallback: str = "mastered") -> str:
    """Limpia un nombre de tema provisto por el usuario para usarlo como filename seguro."""
    if not name:
        return fallback
    name = name.strip()
    if not name:
        return fallback
    name = name.replace("/", "-").replace("\\", "-")
    name = "".join(c for c in name if c.isprintable())
    safe = "".join(c for c in name if c.isalnum() or c in " ._-()[]áéíóúÁÉÍÓÚñÑüÜ")
    safe = safe.strip(" .")
    safe = safe[:120]
    return safe or fallback

async def read_and_validate(file: UploadFile) -> bytes:
    """Lee y valida un archivo subido: extensión permitida + tamaño máximo."""
    # Validar extensión PRIMERO antes de leer (evita procesar datos innecesarios)
    validate_audio_file(file.filename)
    # Luego validar tamaño
    data = await file.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(413, f"Archivo demasiado grande. Máximo: {MAX_FILE_SIZE // 1024 // 1024} MB")
    logger.info(f"✓ Upload validado: {file.filename} ({len(data) / 1024 / 1024:.1f} MB)")
    return data

async def resolve_input_source(file: Optional[UploadFile], library_id: Optional[str]) -> tuple:
    """Resuelve el audio de entrada de un endpoint que acepta O un archivo
    subido O un library_id (archivo ya guardado en LIBRARY_DIR). Devuelve
    (data: bytes, filename: str). Reemplaza el
    `validate_audio_file(file.filename); data = await read_and_validate(file)`
    que se repetía en cada endpoint de mastering — agregar soporte de
    librería a un endpoint nuevo es agregar `library_id` a la firma y
    reemplazar esas dos líneas por una llamada acá."""
    if library_id:
        path = library.get_path(LIBRARY_DIR, library_id)
        if path is None:
            raise HTTPException(404, "Archivo de la librería no encontrado (¿se borró?).")
        meta = library.get_meta(LIBRARY_DIR, library_id)
        filename = meta["original_filename"] if meta else os.path.basename(path)
        with open(path, "rb") as f:
            data = f.read()
        if len(data) > MAX_FILE_SIZE:
            raise HTTPException(413, f"Archivo demasiado grande. Máximo: {MAX_FILE_SIZE // 1024 // 1024} MB")
        return data, filename
    if file is None:
        raise HTTPException(400, "Falta el archivo: mandá 'file' o 'library_id'.")
    validate_audio_file(file.filename)
    data = await read_and_validate(file)
    return data, file.filename


# BUGFIX (/ai/auto-master): ai_assistant.decide_mastering() devuelve estas 4
# claves en escala LINEAL (0-1) con el nombre interno viejo del motor, pero
# process_audio()/apply_mastering_chain() esperan la versión "_db" (en dB) —
# no existe ningún "comp_threshold" ni "mb_low_threshold" etc. en la firma de
# process_audio(), que tampoco tiene **kwargs. Sin este fix, process_audio(
# **params) explota con "unexpected keyword argument" y el job de auto-master
# termina siempre en status=error. Se convierte lineal->dB (20*log10) y se
# renombra a la clave real que el motor espera.
_AI_LINEAR_TO_DB_PARAMS = {
    "comp_threshold": "comp_threshold_db",
    "mb_low_threshold": "mb_low_threshold_db",
    "mb_mid_threshold": "mb_mid_threshold_db",
    "mb_high_threshold": "mb_high_threshold_db",
}


def _fix_ai_decision_params(decision: dict) -> dict:
    """Normaliza el dict que devuelve decide_mastering() a los nombres/escala
    reales que acepta process_audio() (ver _AI_LINEAR_TO_DB_PARAMS)."""
    fixed = dict(decision)
    for linear_key, db_key in _AI_LINEAR_TO_DB_PARAMS.items():
        if linear_key in fixed:
            linear_val = fixed.pop(linear_key)
            try:
                fixed[db_key] = round(20.0 * math.log10(max(float(linear_val), 1e-6)), 2)
            except (TypeError, ValueError):
                pass
    return fixed


def _get_input_duration(input_path: str) -> Optional[float]:
    """Calcula la duración del archivo para que /dashboard pueda estimar el ETA del job."""
    duration = audio_service.get_duration(input_path)
    if duration is None:
        logger.warning(f"No se pudo calcular la duración de '{input_path}'")
    return duration


def cleanup_old() -> None:
    """Elimina archivos viejos (con TTL) en PROCESSED_DIR y STEMS_DIR.
    Evita llenar disco y reduce clutter. Se llama antes de cada job importante."""
    now = time.time()
    deleted_files = 0
    deleted_dirs = 0
    
    # Limpiar archivos individuales en PROCESSED_DIR
    try:
        for fname in os.listdir(PROCESSED_DIR):
            fpath = os.path.join(PROCESSED_DIR, fname)
            try:
                if os.path.isfile(fpath) and (now - os.path.getmtime(fpath)) > PROCESSED_TTL:
                    os.remove(fpath)
                    deleted_files += 1
            except OSError as e:
                logger.warning(f"No se pudo borrar {fpath}: {e}")
    except OSError as e:
        logger.warning(f"Error accediendo PROCESSED_DIR: {e}")
    
    # Limpiar directorios viejos en STEMS_DIR
    try:
        import shutil
        for dirname in os.listdir(STEMS_DIR):
            dpath = os.path.join(STEMS_DIR, dirname)
            try:
                if os.path.isdir(dpath) and (now - os.path.getmtime(dpath)) > PROCESSED_TTL:
                    shutil.rmtree(dpath, ignore_errors=True)
                    deleted_dirs += 1
            except OSError as e:
                logger.warning(f"No se pudo borrar directorio {dpath}: {e}")
    except OSError as e:
        logger.warning(f"Error accediendo STEMS_DIR: {e}")
    
    if deleted_files > 0 or deleted_dirs > 0:
        logger.info(f"🧹 Cleanup: {deleted_files} archivos + {deleted_dirs} directorios borrados (TTL: {PROCESSED_TTL}s)")

def _make_progress_cb(job_id: str):
    """Crea el callback que process_audio()/process_audio_with_reference()
    invocan en cada etapa de la cadena. Actualiza directamente el dict
    `jobs[job_id]`, que ya es lo que devuelve GET /job/{id} — así el
    frontend puede pollear progreso/etapa sin ningún endpoint nuevo."""
    def _cb(pct: int, stage: str):
        if not jobs.exists(job_id):
            return
        jobs.update_job(job_id, progress=pct, stage=stage)
    return _cb

def run_mastering_job(job_id: str, input_path: str, params: dict):
    jobs.update_job(job_id, status="processing", started_at=time.time(), progress=0, stage="Iniciando procesamiento")
    try:
        cleanup_old()
        result = process_audio(input_path, progress_cb=_make_progress_cb(job_id), **params)
        jobs.update_job(job_id, status="done", result=result, finished_at=time.time(),
                        progress=100, stage="Completado")
        logger.info(f"Job {job_id} done: {result['output_path']}")
    except Exception as e:
        jobs.update_job(job_id, status="error", error=str(e))
        logger.error(f"Job {job_id} failed: {e}", exc_info=True)
    finally:
        if os.path.exists(input_path):
            os.remove(input_path)

def run_reference_job(job_id: str, input_path: str, reference_path: str, params: dict):
    jobs.update_job(job_id, status="processing", started_at=time.time(), progress=0, stage="Iniciando procesamiento")
    try:
        cleanup_old()
        result = process_audio_with_reference(
            input_path, reference_path, progress_cb=_make_progress_cb(job_id), **params
        )
        jobs.update_job(job_id, status="done", result=result, finished_at=time.time(),
                        progress=100, stage="Completado")
        logger.info(f"Job {job_id} (reference match) done: {result['output_path']}")
    except Exception as e:
        jobs.update_job(job_id, status="error", error=str(e))
        logger.error(f"Job {job_id} (reference match) failed: {e}", exc_info=True)
    finally:
        if os.path.exists(input_path):
            os.remove(input_path)
        if os.path.exists(reference_path):
            os.remove(reference_path)

def run_normalize_job(job_id: str, input_path: str, params: dict):
    """Job de normalización pura por LUFS (#sin-otra-etapa): solo mide LUFS y
    aplica una ganancia, sin EQ/dinámica/referencia. Mismo patrón que
    run_mastering_job/run_reference_job."""
    jobs.update_job(job_id, status="processing", started_at=time.time(), progress=0, stage="Iniciando normalización")
    try:
        cleanup_old()
        result = normalize_by_lufs(
            input_path, progress_cb=_make_progress_cb(job_id), **params
        )
        jobs.update_job(job_id, status="done", result=result, finished_at=time.time(),
                        progress=100, stage="Completado")
        logger.info(f"Job {job_id} (lufs normalize) done: {result['output_path']}")
    except Exception as e:
        jobs.update_job(job_id, status="error", error=str(e))
        logger.error(f"Job {job_id} (lufs normalize) failed: {e}", exc_info=True)
    finally:
        if os.path.exists(input_path):
            os.remove(input_path)

def run_stems_job(job_id: str, input_path: str, mode: str = "demucs_4stem"):
    """Job de separación de stems (#13). Mismo patrón que
    run_mastering_job/run_reference_job: actualiza jobs[job_id] in-place
    para que /job/{id} lo pueda pollear con progress/stage.

    mode:
      "demucs_4stem" (default) -> Demucs htdemucs_ft, vocals/drums/bass/other.
      "vocals_hq"              -> BS-RoFormer/Mel-RoFormer, solo vocals/instrumental,
                                   mejor calidad de aislamiento de voz a costa de
                                   perder el desglose de batería/bajo.
    """
    jobs.update_job(job_id, status="processing", started_at=time.time(), progress=0, stage="Iniciando separación")
    try:
        cleanup_old()
        # BUGFIX potencial: librosa.load fuerza el mismo sr para todos los
        # canales y decodifica a float32; usamos el mismo loader que
        # /analyze y /spectrum para que el comportamiento con distintos
        # formatos (mp3/flac/etc.) sea consistente en toda la app.
        audio, sr = librosa.load(input_path, sr=None, mono=False)
        if audio.ndim == 1:
            audio = audio[np.newaxis, :]

        if mode == "vocals_hq":
            stems = separate_vocals_hq(audio, sr, progress_cb=_make_progress_cb(job_id))
        else:
            stems = separate_stems(audio, sr, progress_cb=_make_progress_cb(job_id))

        jobs.update_job(job_id, stage="Analizando stems", progress=96)
        # Timeout duro: si el análisis se cuelga por cualquier motivo (ej. un
        # futuro conflicto de threads entre libs), el job termina en error
        # después de ANALYSIS_TIMEOUT_SEC en vez de quedar trabado para
        # siempre en 96% (que es justamente lo que pasó antes de este fix).
        import concurrent.futures
        ANALYSIS_TIMEOUT_SEC = 180
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        future = pool.submit(analyze_stems_full, stems, sr, measure_lufs_integrated)
        try:
            analysis = future.result(timeout=ANALYSIS_TIMEOUT_SEC)
            pool.shutdown(wait=False)
        except concurrent.futures.TimeoutError:
            # wait=False: si el thread realmente está colgado (deadlock),
            # esperar a que termine (shutdown default) nos colgaría acá
            # también. Lo abandonamos y seguimos.
            pool.shutdown(wait=False)
            raise RuntimeError(
                f"El análisis de stems no terminó en {ANALYSIS_TIMEOUT_SEC}s "
                f"(se colgó). Los stems separados están listos igual; "
                f"revisar stem_analysis.py."
            )

        stem_dir = os.path.join(STEMS_DIR, job_id)
        os.makedirs(stem_dir, exist_ok=True)
        stem_paths = {}
        for name, stem_audio in stems.items():
            out_path = os.path.join(stem_dir, f"{name}.wav")
            data_to_write = stem_audio.T if stem_audio.ndim == 2 else stem_audio
            sf.write(out_path, data_to_write, sr, subtype="PCM_24")
            stem_paths[name] = out_path

        jobs.update_job(
            job_id,
            status="done", finished_at=time.time(), progress=100, stage="Completado",
            stem_analysis=analysis, stem_paths=stem_paths,
            available_stems=list(stem_paths.keys()),
        )
        logger.info(f"Job {job_id} (stems) done: {list(stem_paths.keys())}")
    except Exception as e:
        jobs.update_job(job_id, status="error", error=str(e))
        logger.error(f"Job {job_id} (stems) failed: {e}", exc_info=True)
    finally:
        if os.path.exists(input_path):
            os.remove(input_path)


app.include_router(create_info_router(
    app=app,
    jobs=jobs,
    upload_dir=UPLOAD_DIR,
    processed_dir=PROCESSED_DIR,
    stems_dir=STEMS_DIR,
    max_file_size=MAX_FILE_SIZE,
    mastering_presets=MASTERING_PRESETS,
    get_preset=get_preset,
    platform_loudness_targets=PLATFORM_LOUDNESS_TARGETS,
))
app.include_router(create_library_router(
    library_module=library,
    library_dir=LIBRARY_DIR,
    read_and_validate=read_and_validate,
    validate_audio_file=validate_audio_file,
))
app.include_router(create_reference_library_router(
    reference_library_module=ref_lib,
    reference_library_dir=REFERENCE_LIBRARY_DIR,
))
app.include_router(create_dashboard_router(
    jobs=jobs,
    get_system_stats=get_system_stats,
    logger=logger,
))
app.include_router(create_jobs_router(
    jobs=jobs,
    sanitize_track_name=sanitize_track_name,
))
app.include_router(create_auth_router(logger=logger))
app.include_router(create_analysis_router(
    upload_dir=UPLOAD_DIR,
    read_and_validate=read_and_validate,
    logger=logger,
    current_user_dependency=get_current_user,
    audio_service=audio_service,
))
app.include_router(create_ai_router(
    upload_dir=UPLOAD_DIR,
    read_and_validate=read_and_validate,
    resolve_input_source=resolve_input_source,
    validate_audio_file=validate_audio_file,
    jobs=jobs,
    logger=logger,
    run_mastering_job=run_mastering_job,
    current_user_dependency=get_current_user,
))

# ── Endpoints movidos a routers/ ───────────────────────────────────────────────
# - auth
# - analysis
# - ai
# Se mantienen aquí solo utilidades de negocio y endpoints de mastering/mix.

@app.post("/stems/separate", tags=["Stems"])
async def stems_separate(background_tasks: BackgroundTasks, file: UploadFile = File(...),
                          mode: str = Form("demucs_4stem"),
    current_user: dict = Depends(get_current_user),
):
    """Separa el track en stems con Demucs (mode="demucs_4stem", default:
    vocals/drums/bass/other) o con BS-RoFormer/Mel-RoFormer (mode="vocals_hq":
    solo vocals/instrumental, mejor aislamiento de voz), analiza cada uno
    individualmente y detecta colisiones espectrales entre ellos (ej. kick
    tapando al bajo — solo aplica en modo demucs_4stem). Encola el job igual
    que /master — se pollea con el mismo /job/{job_id} de siempre."""
    if mode not in ("demucs_4stem", "vocals_hq"):
        raise HTTPException(400, f"mode inválido: '{mode}'. Válidos: demucs_4stem, vocals_hq")
    validate_audio_file(file.filename)
    data = await read_and_validate(file)
    job_id = uuid.uuid4().hex
    input_path = os.path.join(UPLOAD_DIR, f"{job_id}_{file.filename}")
    with open(input_path, "wb") as f:
        f.write(data)

    duration = _get_input_duration(input_path)
    job_params = {"mode": mode}
    if duration is not None:
        job_params["_input_duration_sec"] = duration

    jobs.create_job(job_id, {
        "status": "queued", "type": "stems", "filename": file.filename,
        "created_at": time.time(), "params": job_params, "progress": 0, "stage": "En cola",
    })
    background_tasks.add_task(run_stems_job, job_id, input_path, mode)
    return {"job_id": job_id, "status": "queued", "poll_url": f"/job/{job_id}"}


@app.get("/stems/download/{job_id}/{stem_name}", tags=["Stems"])
def stems_download(job_id: str, stem_name: str):
    if not jobs.exists(job_id):
        raise HTTPException(404, "Job no encontrado")
    job = jobs.get_job(job_id)
    if job.get("type") != "stems" or job["status"] != "done":
        raise HTTPException(400, f"Job no listo: {job.get('status')}")
    stem_path = job.get("stem_paths", {}).get(stem_name)
    if not stem_path or not os.path.exists(stem_path):
        raise HTTPException(410, "Stem no encontrado o expirado. Volvé a separar el track.")
    return FileResponse(stem_path, media_type="audio/wav", filename=f"{stem_name}.wav")


@app.websocket("/ws/master-stream")
async def ws_master_stream(websocket: WebSocket):
    await websocket.accept()
    tmp_path = None
    try:
        config_msg = await websocket.receive_json()
        chunk_seconds = float(config_msg.get("chunk_seconds", 1.0))
        preset_name = config_msg.get("preset")
        platform = config_msg.get("platform_target")
        preview_seconds_stream = config_msg.get("preview_seconds")
        # session_id identifica el archivo actual en el caché del servidor.
        # El cliente lo genera al cargar un archivo (crypto.randomUUID()) y lo
        # envía en cada preview del mismo archivo para evitar re-subir los bytes.
        session_id = config_msg.get("session_id")
        # library_id: el archivo ya vive en LIBRARY_DIR (subido antes desde el
        # panel de librería). Si viene y no hay cache aún para este session_id,
        # se lee directo del disco del servidor — el cliente no manda bytes.
        library_id = config_msg.get("library_id")

        chain_params = {k: v for k, v in config_msg.items() if k not in (
            "chunk_seconds", "preset", "platform_target", "preview_seconds", "type",
            "session_id", "library_id",
        )}
        if preset_name:
            chain_params = {**get_preset(preset_name), **chain_params}
            chain_params.pop("label", None)
        if platform:
            chain_params["use_lufs_normalize"] = True
            chain_params["target_lufs"] = get_platform_target(platform)["lufs"]
        chain_params = coerce_ws_chain_params(chain_params)

        # ── Audio: intentar reusar del caché antes de pedir el upload ─────────
        audio = sr = None

        if session_id:
            cached = audio_cache_get(session_id)
            if cached is not None:
                audio, sr = cached
                # Avisamos al cliente: puede saltarse el upload de bytes.
                # El cliente responde {"event":"params_only"} y no envía binarios.
                await websocket.send_json({"event": "use_cache"})

        if audio is None and library_id:
            lib_path = library.get_path(LIBRARY_DIR, library_id)
            if lib_path is None:
                await websocket.send_json({
                    "event": "error",
                    "message": "Archivo de la librería no encontrado (¿se borró?).",
                })
                return
            # librosa.load es CPU-bound → threadpool para no bloquear el event loop.
            audio, sr = await run_in_threadpool(librosa.load, lib_path, sr=None, mono=False)
            if audio.ndim == 1:
                audio = audio[np.newaxis, :]
            preview_window = float(preview_seconds_stream) if preview_seconds_stream else 10.0
            audio = _crop_preview(audio, sr, preview_window)
            if session_id:
                audio_cache_put(session_id, audio, sr)
            # Igual que con el caché: el cliente no necesita mandar bytes.
            await websocket.send_json({"event": "use_cache"})

        if audio is None:
            # No hay caché ni library_id utilizable → hace falta el archivo.
            # BUGFIX: antes el cliente empezaba a mandar los bytes del
            # archivo en cuanto abría el WebSocket, SIN esperar ninguna
            # confirmación del servidor — por eso "use_cache" nunca ahorraba
            # banda de verdad: el cliente igual mandaba todo en paralelo.
            # Este evento explícito es la señal que el cliente ahora espera
            # antes de leer/enviar el archivo (ver index.html, ws.onmessage).
            await websocket.send_json({"event": "need_upload"})
            # Recibir el archivo en trozos (igual que antes).
            audio_chunks = []
            total_size = 0
            while True:
                message = await websocket.receive()
                if message.get("bytes") is not None:
                    chunk = message["bytes"]
                    total_size += len(chunk)
                    if total_size > MAX_FILE_SIZE:
                        await websocket.send_json({
                            "event": "error",
                            "message": f"Archivo demasiado grande. Máximo: {MAX_FILE_SIZE // 1024 // 1024} MB",
                        })
                        return
                    audio_chunks.append(chunk)
                elif message.get("text") is not None:
                    try:
                        ctrl = json.loads(message["text"])
                    except Exception:
                        ctrl = {}
                    # "upload_complete" = flujo viejo; "params_only" = flujo nuevo con caché
                    if ctrl.get("event") in ("upload_complete", "params_only"):
                        break
                elif message.get("type") == "websocket.disconnect":
                    return
                else:
                    break

            audio_bytes = b"".join(audio_chunks)
            if not audio_bytes:
                await websocket.send_json({"event": "error", "message": "No se recibió audio."})
                return

            tmp_path = os.path.join(UPLOAD_DIR, f"stream_{uuid.uuid4().hex}")
            with open(tmp_path, "wb") as f:
                f.write(audio_bytes)

            # librosa.load es CPU-bound → threadpool para no bloquear el event loop.
            audio, sr = await run_in_threadpool(librosa.load, tmp_path, sr=None, mono=False)
            if audio.ndim == 1:
                audio = audio[np.newaxis, :]

            # Recortar el preview ANTES de cachear: así todos los previews
            # siguientes (mismo session_id, distintos parámetros) usan exactamente
            # el mismo extracto sin volver a recortar.
            preview_window = float(preview_seconds_stream) if preview_seconds_stream else 10.0
            audio = _crop_preview(audio, sr, preview_window)

            # Guardar en caché para los próximos previews de esta sesión.
            if session_id:
                audio_cache_put(session_id, audio, sr)

        chain_params.pop("output_format", None)
        chain_params.pop("preview_seconds", None)

        # PERF: bypasear stages costosos que no son perceptibles en preview de 10s.
        # Reducen el tiempo de procesamiento por chunk ~40%.
        # El usuario puede activarlos explícitamente si los necesita.
        for _bypass_key in ("nr_bypass", "dyneq_bypass", "reso_bypass", "tonal_balance_bypass"):
            chain_params.setdefault(_bypass_key, True)

        # BUGFIX: apply_mastering_chain (lo que corre por chunk) ignora
        # use_lufs_normalize/target_peak/target_lufs — esos campos no hacen
        # nada dentro de la cadena en sí. Antes esto significaba que
        # "Normalizar por LUFS" no tenía ningún efecto en el preview en vivo,
        # aunque sí funcionara en el archivo final (/master, /master/sync,
        # /preview pasan por process_audio, que sí corre el safety check).
        # Acá se corre el mismo safety check UNA vez, en batch, sobre el
        # audio ya recortado al preview — no por chunk, porque sería carísimo
        # y generaría saltos de gain audibles en tiempo real — y el
        # input_gain_db corregido resultante es el que se usa para generar
        # todos los chunks del stream.
        # PERF: compute_lufs_corrected_gain analiza el audio completo — antes
        # bloqueaba el inicio del stream. Ahora el stream arranca inmediato y
        # el gain LUFS se aplica a partir del segundo chunk si ya está listo.
        _lufs_gain_ready = False
        if chain_params.get("use_lufs_normalize"):
            target_lufs_val = float(chain_params.get("target_lufs", -14.0))
            import asyncio
            _lufs_fut = asyncio.ensure_future(run_in_threadpool(
                compute_lufs_corrected_gain, audio, sr, dict(chain_params), target_lufs_val
            ))
        else:
            _lufs_fut = None

        chunk_gen = master_stream_to_pcm16(audio, sr, chunk_seconds=chunk_seconds,
                                          pcm_format="int16", **chain_params)
        _SENTINEL = object()

        def _next_ws_chunk():
            try:
                return next(chunk_gen)
            except StopIteration:
                return _SENTINEL

        while True:
            # Aplicar gain LUFS en cuanto esté listo (sin bloquear el stream)
            if _lufs_fut is not None and _lufs_fut.done() and not _lufs_gain_ready:
                try:
                    corrected_gain, lufs_notes = _lufs_fut.result()
                    chain_params["input_gain_db"] = corrected_gain
                    chunk_gen = master_stream_to_pcm16(audio, sr, chunk_seconds=chunk_seconds,
                                                      pcm_format="int16", **chain_params)
                    _lufs_gain_ready = True
                    await websocket.send_json({
                        "event": "lufs_safety",
                        "target_lufs": round(target_lufs_val, 2),
                        "corrected_input_gain_db": round(corrected_gain, 2),
                        "notes": lufs_notes,
                    })
                except Exception:
                    _lufs_fut = None
            item = await run_in_threadpool(_next_ws_chunk)
            if item is _SENTINEL:
                break
            pcm_bytes, metrics = item
            await websocket.send_json({"event": "chunk", "metrics": metrics, "sample_rate": sr, "channels": int(audio.shape[0])})
            await websocket.send_bytes(pcm_bytes)

        await websocket.send_json({"event": "done"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"ws_master_stream error: {e}", exc_info=True)
        try:
            await websocket.send_json({"event": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


# ─── WebSocket: preview en tiempo real con referencia ─────────────────────────
# Flujo:
#   1. Cliente envía JSON de config (params de matching + band_gains_db)
#   2. Servidor responde need_upload / use_cache para el archivo PROPIO
#   3. Cliente responde need_upload_ref / use_cache_ref para la REFERENCIA
#   4. Servidor calcula EQ de matching FIR UNA VEZ contra la referencia
#   5. Aplica ganancias manuales por banda (band_gains_db)
#   6. Hace streaming del audio procesado chunk a chunk (PCM16 + métricas)
#
# Preview: siempre 10 segundos a partir del segundo 40 (o desde el inicio
# si la pista es más corta). El mismo fragmento se reutiliza mientras no
# cambie el session_id, asegurando comparación consistente entre distintas
# configuraciones de sliders.

PREVIEW_START_SEC = 40.0
PREVIEW_DURATION_SEC = 10.0

def _crop_ref_preview(audio: np.ndarray, sr: int,
                      start_sec: float = PREVIEW_START_SEC,
                      duration_sec: float = PREVIEW_DURATION_SEC) -> np.ndarray:
    """Recorta `duration_sec` segundos a partir de `start_sec`.
    Si la pista es más corta que start_sec, arranca desde 0.
    Siempre devuelve exactamente duration_sec segundos (o el total si es más corto)."""
    total = audio.shape[-1]
    start_sample = int(min(start_sec, max(0.0, total / sr - duration_sec)) * sr)
    end_sample = min(start_sample + int(duration_sec * sr), total)
    return audio[:, start_sample:end_sample]


@app.websocket("/ws/ref-stream")
async def ws_ref_stream(websocket: WebSocket):
    """Preview en tiempo real del match por referencia con sliders de banda."""
    await websocket.accept()
    tmp_src = tmp_ref = None
    try:
        # ── 1. Configuración ───────────────────────────────────────────────────
        cfg = await websocket.receive_json()

        session_id     = cfg.get("session_id")      # caché del archivo propio
        ref_session_id = cfg.get("ref_session_id")  # caché de la referencia
        library_id     = cfg.get("library_id")
        ref_library_id = cfg.get("ref_library_id")
        chunk_seconds  = float(cfg.get("chunk_seconds", 2.0))

        # Parámetros de matching
        eq_bands        = int(cfg.get("eq_bands", 28))
        eq_max_boost    = float(cfg.get("eq_max_boost_db", 6.0))
        eq_max_cut      = float(cfg.get("eq_max_cut_db", -9.0))
        eq_q            = float(cfg.get("eq_q", 1.3))
        eq_blend        = float(cfg.get("eq_match_blend", 0.75))
        eq_fit_method   = str(cfg.get("eq_fit_method", "heuristic"))
        ms_eq_matching  = bool(cfg.get("ms_eq_matching", True))
        hp_cutoff       = float(cfg.get("hp_cutoff", 30.0))
        band_gains_db   = cfg.get("band_gains_array") or cfg.get("band_gains_db") or []

        # ── 2. Cargar archivo PROPIO ───────────────────────────────────────────
        audio = sr = None

        if session_id:
            cached = audio_cache_get(session_id)
            if cached is not None:
                audio, sr = cached
                await websocket.send_json({"event": "use_cache"})

        if audio is None and library_id:
            lib_path = library.get_path(LIBRARY_DIR, library_id)
            if lib_path is None:
                await websocket.send_json({"event": "error", "message": "Archivo propio no encontrado en librería."})
                return
            audio, sr = await run_in_threadpool(librosa.load, lib_path, sr=None, mono=False)
            if audio.ndim == 1:
                audio = audio[np.newaxis, :]
            audio = _crop_ref_preview(audio, sr)
            if session_id:
                audio_cache_put(session_id, audio, sr)
            await websocket.send_json({"event": "use_cache"})

        if audio is None:
            await websocket.send_json({"event": "need_upload"})
            chunks, total_size = [], 0
            while True:
                msg = await websocket.receive()
                if msg.get("bytes"):
                    total_size += len(msg["bytes"])
                    if total_size > MAX_FILE_SIZE:
                        await websocket.send_json({"event": "error", "message": "Archivo demasiado grande."})
                        return
                    chunks.append(msg["bytes"])
                elif msg.get("text"):
                    ctrl = json.loads(msg["text"])
                    if ctrl.get("event") in ("upload_complete", "params_only"):
                        break
                elif msg.get("type") == "websocket.disconnect":
                    return
            audio_bytes = b"".join(chunks)
            if not audio_bytes:
                await websocket.send_json({"event": "error", "message": "No se recibió audio."})
                return
            tmp_src = os.path.join(UPLOAD_DIR, f"refws_src_{uuid.uuid4().hex}")
            with open(tmp_src, "wb") as f:
                f.write(audio_bytes)
            audio, sr = await run_in_threadpool(librosa.load, tmp_src, sr=None, mono=False)
            if audio.ndim == 1:
                audio = audio[np.newaxis, :]
            audio = _crop_ref_preview(audio, sr)
            if session_id:
                audio_cache_put(session_id, audio, sr)

        # ── 3. Cargar REFERENCIA ───────────────────────────────────────────────
        ref_audio = ref_sr = None

        if ref_session_id:
            cached_ref = audio_cache_get(ref_session_id)
            if cached_ref is not None:
                ref_audio, ref_sr = cached_ref
                await websocket.send_json({"event": "use_cache_ref"})

        if ref_audio is None and ref_library_id:
            lib_ref_path = library.get_path(LIBRARY_DIR, ref_library_id)
            if lib_ref_path is None:
                await websocket.send_json({"event": "error", "message": "Referencia no encontrada en librería."})
                return
            ref_audio, ref_sr = await run_in_threadpool(librosa.load, lib_ref_path, sr=None, mono=False)
            if ref_audio.ndim == 1:
                ref_audio = ref_audio[np.newaxis, :]
            if ref_session_id:
                audio_cache_put(ref_session_id, ref_audio, ref_sr)
            await websocket.send_json({"event": "use_cache_ref"})

        if ref_audio is None:
            await websocket.send_json({"event": "need_upload_ref"})
            ref_chunks, ref_total = [], 0
            while True:
                msg = await websocket.receive()
                if msg.get("bytes"):
                    ref_total += len(msg["bytes"])
                    if ref_total > MAX_FILE_SIZE:
                        await websocket.send_json({"event": "error", "message": "Referencia demasiado grande."})
                        return
                    ref_chunks.append(msg["bytes"])
                elif msg.get("text"):
                    ctrl = json.loads(msg["text"])
                    if ctrl.get("event") in ("upload_complete", "params_only"):
                        break
                elif msg.get("type") == "websocket.disconnect":
                    return
            ref_bytes = b"".join(ref_chunks)
            if not ref_bytes:
                await websocket.send_json({"event": "error", "message": "No se recibió referencia."})
                return
            tmp_ref = os.path.join(UPLOAD_DIR, f"refws_ref_{uuid.uuid4().hex}")
            with open(tmp_ref, "wb") as f:
                f.write(ref_bytes)
            ref_audio, ref_sr = await run_in_threadpool(librosa.load, tmp_ref, sr=None, mono=False)
            if ref_audio.ndim == 1:
                ref_audio = ref_audio[np.newaxis, :]
            if ref_session_id:
                audio_cache_put(ref_session_id, ref_audio, ref_sr)

        # ── 4. Calcular EQ de matching FIR contra la referencia ───────────────
        await websocket.send_json({"event": "analyzing", "message": "Calculando EQ de matching..."})

        def _compute_matching(audio, sr, ref_audio, ref_sr):
            nyquist  = min(sr, ref_sr) / 2.0
            max_freq = float(np.clip(min(20000.0, nyquist - 100.0), 200.0, nyquist - 1.0))
            edges    = np.logspace(np.log10(20.0), np.log10(max_freq), eq_bands + 1)
            band_edges = list(zip(edges[:-1].tolist(), edges[1:].tolist()))
            centers  = [float(np.sqrt(lo * hi)) for lo, hi in band_edges]
            src_bands_db = spectral_energy_at_bands(audio, sr, band_edges)
            ref_bands_db = spectral_energy_at_bands(ref_audio, ref_sr, band_edges)
            if eq_fit_method == "ddsp":
                src_mr = spectral_energy_at_bands_multires(audio, sr, band_edges)
                ref_mr = spectral_energy_at_bands_multires(ref_audio, ref_sr, band_edges)
                curve  = compute_reference_eq_curve_ddsp(src_mr, ref_mr, centers,
                                                          max_boost_db=eq_max_boost,
                                                          max_cut_db=eq_max_cut)
            else:
                curve = compute_reference_eq_curve(src_bands_db, ref_bands_db, centers,
                                                   max_boost_db=eq_max_boost,
                                                   max_cut_db=eq_max_cut,
                                                   blend=eq_blend)
            processed = eq_high_pass(audio, sr, cutoff_hz=hp_cutoff)
            if ms_eq_matching and processed.ndim == 2 and processed.shape[0] == 2:
                src_mr_ms = src_mr if eq_fit_method == "ddsp" else None
                ref_mr_ms = ref_mr if eq_fit_method == "ddsp" else None
                curve_mid, curve_side = compute_ms_eq_curves(
                    processed, sr, ref_audio, ref_sr,
                    band_edges=band_edges, centers=centers,
                    max_boost_db=eq_max_boost, max_cut_db=eq_max_cut,
                    blend=eq_blend, eq_fit_method=eq_fit_method,
                    src_bands_multires=src_mr_ms, ref_bands_multires=ref_mr_ms,
                )
                processed = apply_ms_matching_fir(processed, sr, curve_mid, curve_side, eq_q=eq_q)
                curve = curve_mid  # para el evento matching_ready / reporte (Mid es la más representativa)
            else:
                fir_taps = build_matching_fir(curve, sr, precision=eq_q)
                processed = apply_matching_fir(processed, sr, fir_taps)
            # Ganancias manuales por banda — array dinámico [{freq_hz, gain_db}]
            n = len(band_gains_db)
            auto_q = float(max(0.7, min(2.0, 0.5 + (n / 28.0) * 1.5))) if n else 1.0
            for entry in band_gains_db:
                freq_hz = float(entry.get("freq_hz", 0))
                gain    = float(entry.get("gain_db", 0.0))
                if freq_hz >= 10 and abs(gain) >= 0.1:
                    processed = eq_parametric_band(processed, sr, freq=freq_hz, gain_db=gain, q=auto_q)
            return processed, curve

        audio_matched, eq_curve = await run_in_threadpool(_compute_matching, audio, sr, ref_audio, ref_sr)

        await websocket.send_json({
            "event": "matching_ready",
            "eq_curve": [{"freq_hz": round(f, 1), "gain_db": round(g, 2)} for f, g in eq_curve],
        })

        # ── 4b. Dinámica multibanda calibrada contra la referencia ────────────
        # BUGFIX (preview de match mastering sin GR real): antes acá no se
        # pasaba ningún chain_param a master_stream_to_pcm16, así que el
        # multibanda de apply_mastering_chain corría con thresholds genéricos
        # fijos (-18dB, ratio 2.0) sin ninguna relación con la referencia — el
        # GR que se veía (si se veía) no tenía nada que ver con el ajuste real
        # que después aplica process_audio_with_reference en el render final.
        # Ahora se calcula una sola vez, con la misma fórmula banda-por-banda
        # que match_dynamics_bands, y se fuerza mb_bypass=False para que el
        # preview muestre el mismo GR calibrado que va a tener el archivo final.
        mb_chain_params = await run_in_threadpool(
            derive_mb_chain_params_from_reference, audio_matched, sr, ref_audio, ref_sr
        )

        # ── 5. Streaming chunk a chunk ─────────────────────────────────────────
        # Usamos master_stream_to_pcm16 que ya convierte a float32 bytes interleaved
        chunk_gen = master_stream_to_pcm16(audio_matched, sr, chunk_seconds=chunk_seconds,
                                           detect_dynamic_eq=False, **mb_chain_params)
        _SENTINEL = object()

        def _next_ref_chunk():
            try:
                return next(chunk_gen)
            except StopIteration:
                return _SENTINEL

        while True:
            item = await run_in_threadpool(_next_ref_chunk)
            if item is _SENTINEL:
                break
            pcm_bytes, metrics = item
            await websocket.send_json({
                "event": "chunk",
                "metrics": metrics,
                "sample_rate": sr,
                "channels": int(audio_matched.shape[0]),
            })
            await websocket.send_bytes(pcm_bytes)

        await websocket.send_json({"event": "done"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"ws_ref_stream error: {e}", exc_info=True)
        try:
            await websocket.send_json({"event": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        for p in (tmp_src, tmp_ref):
            if p and os.path.exists(p):
                os.remove(p)

# ─── Endpoint con preset (parámetros multibanda ahora opcionales) ──────────────────
@app.post("/master/preset/{preset_name}", tags=["Mastering"])
async def master_with_preset(
    preset_name: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    platform_target: str = Query(None, description="spotify|youtube|apple_music|tidal|club|cd"),
    output_format: str = Form("wav", pattern="^(wav|flac|mp3)$"),
    output_bit_depth: int = Query(24, description="Bit depth de salida (WAV/FLAC): 16, 24 o 32 (float). Se aplica dither TPDF si baja de 32."),
    # Parámetros multibanda opcionales (si no se envían, se respeta el preset)
    mb_low_crossover: float = Query(None, ge=20.0, le=2000.0),
    mb_high_crossover: float = Query(None, ge=500.0, le=20000.0),
    mb_low_threshold_db: float = Query(None, ge=-60.0, le=0.0),
    mb_low_ratio: float = Query(None, ge=1.0, le=20.0),
    mb_low_attack_ms: float = Query(None, ge=0.1, le=200.0),
    mb_low_release_ms: float = Query(None, ge=10.0, le=1000.0),
    mb_low_makeup_db: float = Query(None, ge=-12.0, le=24.0),
    mb_mid_threshold_db: float = Query(None, ge=-60.0, le=0.0),
    mb_mid_ratio: float = Query(None, ge=1.0, le=20.0),
    mb_mid_attack_ms: float = Query(None, ge=0.1, le=200.0),
    mb_mid_release_ms: float = Query(None, ge=10.0, le=1000.0),
    mb_mid_makeup_db: float = Query(None, ge=-12.0, le=24.0),
    mb_high_threshold_db: float = Query(None, ge=-60.0, le=0.0),
    mb_high_ratio: float = Query(None, ge=1.0, le=20.0),
    mb_high_attack_ms: float = Query(None, ge=0.1, le=200.0),
    mb_high_release_ms: float = Query(None, ge=10.0, le=1000.0),
    mb_high_makeup_db: float = Query(None, ge=-12.0, le=24.0),
    mb_bypass: Optional[bool] = Query(None),
    input_gain_db: Optional[float] = Query(None, ge=-24.0, le=24.0),
):
    try:
        params = get_preset(preset_name)
    except KeyError as e:
        raise HTTPException(404, str(e))
    params.pop("label", None)
    params["output_format"] = output_format
    params["output_bit_depth"] = output_bit_depth
    if platform_target:
        params["platform_target"] = platform_target
    # Solo sobrescribir si el usuario envió el valor (no None)
    for key in ["mb_low_crossover", "mb_high_crossover", "mb_low_threshold_db", "mb_low_ratio",
                "mb_low_attack_ms", "mb_low_release_ms", "mb_low_makeup_db",
                "mb_mid_threshold_db", "mb_mid_ratio", "mb_mid_attack_ms", "mb_mid_release_ms",
                "mb_mid_makeup_db", "mb_high_threshold_db", "mb_high_ratio", "mb_high_attack_ms",
                "mb_high_release_ms", "mb_high_makeup_db"]:
        val = locals().get(key)
        if val is not None:
            params[key] = val
    if mb_bypass is not None:
        params["mb_bypass"] = mb_bypass
    if input_gain_db is not None:
        params["input_gain_db"] = input_gain_db

    validate_audio_file(file.filename)
    data = await read_and_validate(file)
    job_id = uuid.uuid4().hex
    input_path = os.path.join(UPLOAD_DIR, f"{job_id}_{file.filename}")
    with open(input_path, "wb") as f: f.write(data)

    duration = _get_input_duration(input_path)
    job_params = {**params, "preset": preset_name}
    if duration is not None:
        job_params["_input_duration_sec"] = duration
    jobs.create_job(job_id, {"status": "queued", "filename": file.filename, "created_at": time.time(),
                     "params": job_params, "progress": 0, "stage": "En cola"})
    background_tasks.add_task(run_mastering_job, job_id, input_path, params)
    return {"job_id": job_id, "status": "queued", "preset": preset_name, "poll_url": f"/job/{job_id}"}

# ── Preview ──────────────────────────────────────────────────────────────────
@app.post("/preview", tags=["Preview"])
async def preview(
    file: UploadFile = File(...),
    target_peak: float        = Query(0.95,   ge=0.1,   le=1.0),
    use_lufs_normalize: bool  = Query(False),
    target_lufs: float        = Query(-14.0,  ge=-40.0, le=0.0),
    # Compresor multibanda con valores más conservadores
    mb_low_crossover: float = Query(250.0, ge=20.0, le=2000.0),
    mb_high_crossover: float = Query(4000.0, ge=500.0, le=20000.0),
    mb_low_threshold_db: float = Query(-18.0, ge=-60.0, le=0.0),
    mb_low_ratio: float = Query(2.0, ge=1.0, le=20.0),
    mb_low_attack_ms: float = Query(20.0, ge=0.1, le=200.0),
    mb_low_release_ms: float = Query(150.0, ge=10.0, le=1000.0),
    mb_low_makeup_db: float = Query(0.0, ge=-12.0, le=24.0),
    mb_mid_threshold_db: float = Query(-18.0, ge=-60.0, le=0.0),
    mb_mid_ratio: float = Query(2.0, ge=1.0, le=20.0),
    mb_mid_attack_ms: float = Query(20.0, ge=0.1, le=200.0),
    mb_mid_release_ms: float = Query(150.0, ge=10.0, le=1000.0),
    mb_mid_makeup_db: float = Query(0.0, ge=-12.0, le=24.0),
    mb_high_threshold_db: float = Query(-18.0, ge=-60.0, le=0.0),
    mb_high_ratio: float = Query(2.0, ge=1.0, le=20.0),
    mb_high_attack_ms: float = Query(20.0, ge=0.1, le=200.0),
    mb_high_release_ms: float = Query(150.0, ge=10.0, le=1000.0),
    mb_high_makeup_db: float = Query(0.0, ge=-12.0, le=24.0),
    mb_bypass: bool = Query(False),
    mb_pdr: bool               = Query(True, description="Program-Dependent Release en el compresor multibanda"),
    mb_pdr_hold_ms: float      = Query(500.0, ge=50.0, le=2000.0),
    input_gain_db: float      = Query(0.0,    ge=-24.0, le=24.0),
    comp_threshold_db: float      = Query(-18.0, ge=-60.0, le=0.0),
    comp_ratio: float          = Query(4.0,   ge=1.0,   le=20.0),
    comp_attack_ms: float      = Query(10.0,  ge=0.1,   le=200.0),
    comp_release_ms: float     = Query(100.0, ge=10.0,  le=1000.0),
    comp_makeup_db: float      = Query(0.0,   ge=-12.0, le=24.0),
    comp_pdr: bool             = Query(True, description="Program-Dependent Release en el compresor de banda ancha/paralela"),
    comp_pdr_hold_ms: float    = Query(500.0, ge=50.0, le=2000.0),
    comp_stereo_link: bool     = Query(True, description="Linkea L/R en el compresor para preservar la imagen estéreo"),
    oversample_mode: str       = Query("quality", pattern="^(off|draft|fast|quality|ultra)$"),
    # Paralle compression controls
    parallel_bypass: bool      = Query(True, description="Bypass para compresión paralela"),
    parallel_threshold_db: float = Query(-12.0, ge=-60.0, le=0.0),
    parallel_ratio: float      = Query(4.0, ge=1.0, le=20.0),
    parallel_attack_ms: float  = Query(10.0, ge=0.1, le=200.0),
    parallel_release_ms: float = Query(100.0, ge=5.0, le=1000.0),
    parallel_mix: float        = Query(0.0, ge=0.0, le=1.0, description="Mezcla dry/wet para compresión paralela (0..1)"),
    # EQ
    hp_cutoff: float          = Query(30.0,   ge=20.0,  le=500.0),
    lp_bypass: bool           = Query(True),
    lp_cutoff: float          = Query(18000.0, ge=1000.0, le=22000.0),
    high_shelf_gain_db: float = Query(2.0,    ge=-12.0, le=12.0),
    high_shelf_freq_hz: float  = Query(8000.0, ge=1000.0, le=20000.0),
    low_shelf_gain_db: float  = Query(0.0,    ge=-12.0, le=12.0),
    low_shelf_freq_hz: float  = Query(100.0,  ge=20.0,  le=2000.0),
    # Multiband Stereo Width
    mb_stereo_bypass: bool          = Query(True),
    mb_stereo_low_width: float      = Query(0.9,   ge=0.0, le=3.0),
    mb_stereo_mid_width: float      = Query(1.2,   ge=0.0, le=3.0),
    mb_stereo_high_width: float     = Query(1.5,   ge=0.0, le=3.0),
    mb_stereo_low_crossover: float  = Query(150.0, ge=20.0, le=2000.0),
    mb_stereo_high_crossover: float = Query(4000.0,ge=200.0, le=20000.0),
    eq1_freq: float = Query(100.0, ge=20.0, le=20000.0), eq1_gain: float = Query(0.0, ge=-12.0, le=12.0), eq1_q: float = Query(1.0, ge=0.1, le=30.0),
    eq2_freq: float = Query(500.0, ge=20.0, le=20000.0), eq2_gain: float = Query(0.0, ge=-12.0, le=12.0), eq2_q: float = Query(1.0, ge=0.1, le=30.0),
    eq3_freq: float = Query(2000.0, ge=20.0, le=20000.0), eq3_gain: float = Query(0.0, ge=-12.0, le=12.0), eq3_q: float = Query(1.0, ge=0.1, le=30.0),
    eq4_freq: float = Query(8000.0, ge=20.0, le=20000.0), eq4_gain: float = Query(0.0, ge=-12.0, le=12.0), eq4_q: float = Query(1.0, ge=0.1, le=30.0),
    eq5_freq: float = Query(200.0,  ge=20.0, le=20000.0), eq5_gain: float = Query(0.0, ge=-12.0, le=12.0), eq5_q: float = Query(1.0, ge=0.1, le=30.0),
    eq6_freq: float = Query(1000.0, ge=20.0, le=20000.0), eq6_gain: float = Query(0.0, ge=-12.0, le=12.0), eq6_q: float = Query(1.0, ge=0.1, le=30.0),
    transient_attack: float   = Query(0.0,   ge=-1.0,  le=1.0),
    transient_sustain: float  = Query(0.0,   ge=-1.0,  le=1.0),
    saturation_drive: float   = Query(0.0,   ge=0.0,   le=1.0),
    saturation_mode: str      = Query("tape", pattern="^(tape|tube|analog)$"),
    saturation_mix: float     = Query(1.0,   ge=0.0,   le=1.0),
    mid_gain_db: float        = Query(0.0,   ge=-12.0, le=12.0),
    side_gain_db: float       = Query(0.0,   ge=-18.0, le=18.0),
    stereo_width_amount: float = Query(1.2,  ge=0.0,   le=3.0),
    use_stereo_enhancer: bool  = Query(False),
    enhancer_bass_mono_freq: float = Query(120.0),
    haas_delay_ms: float      = Query(0.0,   ge=0.0,   le=30.0),
    reverb_size: float        = Query(0.3,   ge=0.05,  le=2.0),
    reverb_wet: float         = Query(0.0,   ge=0.0,   le=1.0),
    glue_bypass: bool         = Query(True),
    glue_threshold_db: float  = Query(-4.0,  ge=-24.0, le=0.0),
    glue_ratio: float         = Query(2.0,   ge=1.0,   le=10.0),
    glue_attack_ms: float     = Query(30.0,  ge=0.1,   le=200.0),
    glue_release_ms: float    = Query(120.0, ge=10.0,  le=1000.0),
    glue_makeup_db: float     = Query(0.0,   ge=-12.0, le=12.0),
    glue_pdr: bool            = Query(True, description="Program-Dependent Release en el glue compressor"),
    glue_pdr_hold_ms: float   = Query(500.0, ge=50.0, le=2000.0),
    limiter_ceiling: float    = Query(0.95,  ge=0.5,   le=1.0),
    limiter_release_ms: float = Query(50.0,  ge=1.0,   le=500.0),
    # EQ de fase lineal (FIR) / Dynamic EQ / Low-End Mono Maker dedicado
    eq_mode: str              = Query("iir", pattern="^(iir|linear_phase)$"),
    linear_phase_taps: int    = Query(2049, ge=257, le=8193),
    low_end_mono_freq: float  = Query(120.0, ge=40.0, le=300.0),
    low_end_mono_amount: float = Query(0.0, ge=0.0, le=1.0),
    dyneq_bypass: bool        = Query(True),
    dyneq_freq: float         = Query(3000.0, ge=200.0, le=16000.0),
    dyneq_q: float            = Query(2.5,   ge=0.5,  le=12.0),
    dyneq_threshold_db: float = Query(-18.0, ge=-60.0, le=0.0),
    dyneq_ratio: float        = Query(3.0,   ge=1.0,  le=20.0),
    dyneq_attack_ms: float    = Query(3.0,   ge=0.1,  le=100.0),
    dyneq_release_ms: float   = Query(80.0,  ge=5.0,  le=1000.0),
    dyneq_max_reduction_db: float = Query(12.0, ge=0.0, le=30.0),
    ms_eq_bypass: bool        = Query(True),
    ms_mid_freq: float        = Query(250.0,  ge=20.0,  le=2000.0),
    ms_mid_gain: float        = Query(0.0,    ge=-12.0, le=12.0),
    ms_mid_q: float           = Query(1.0,    ge=0.1,   le=10.0),
    ms_side_freq: float       = Query(8000.0, ge=1000.0, le=20000.0),
    ms_side_gain: float       = Query(0.0,    ge=-12.0, le=12.0),
    ms_side_q: float          = Query(1.0,    ge=0.1,   le=10.0),
    ms_comp_bypass: bool      = Query(True),
    ms_comp_mid_threshold_db: float = Query(-18.0, ge=-60.0, le=0.0),
    ms_comp_mid_ratio: float        = Query(2.0,   ge=1.0,  le=20.0),
    ms_comp_mid_attack_ms: float    = Query(15.0,  ge=0.1,  le=200.0),
    ms_comp_mid_release_ms: float   = Query(120.0, ge=5.0,  le=2000.0),
    ms_comp_mid_makeup_db: float    = Query(0.0,   ge=0.0,  le=24.0),
    ms_comp_side_threshold_db: float = Query(-18.0, ge=-60.0, le=0.0),
    ms_comp_side_ratio: float        = Query(2.0,   ge=1.0,  le=20.0),
    ms_comp_side_attack_ms: float    = Query(15.0,  ge=0.1,  le=200.0),
    ms_comp_side_release_ms: float   = Query(120.0, ge=5.0,  le=2000.0),
    ms_comp_side_makeup_db: float    = Query(0.0,   ge=0.0,  le=24.0),
    ms_comp_pdr: bool                = Query(True, description="Program-Dependent Release en el compresor M/S"),
    ms_comp_pdr_hold_ms: float       = Query(500.0, ge=50.0, le=2000.0),
    reso_bypass: bool         = Query(True),
    reso_freq: float          = Query(1200.0, ge=200.0, le=16000.0),
    reso_q: float             = Query(3.0,    ge=0.5,   le=12.0),
    reso_threshold_db: float  = Query(-18.0,  ge=-60.0, le=0.0),
    reso_ratio: float         = Query(3.0,    ge=1.0,   le=20.0),
    reso_attack_ms: float     = Query(5.0,    ge=0.1,   le=100.0),
    reso_release_ms: float    = Query(100.0,  ge=5.0,   le=1000.0),
    reso_max_reduction_db: float = Query(8.0, ge=0.0,   le=30.0),
    clipper_bypass: bool      = Query(True),
    clipper_mode: str         = Query("soft", pattern="^(soft|hard)$"),
    clipper_ceiling: float    = Query(0.98,   ge=0.1,   le=1.0),
    clipper_drive_db: float   = Query(0.0,    ge=0.0,   le=24.0),
    nr_bypass: bool           = Query(True,  description="Desactivar para aplicar reducción de ruido antes de la cadena."),
    nr_strength: float        = Query(0.5,   ge=0.0, le=1.0, description="Intensidad de la reducción de ruido (0=nada, 1=máximo)."),
    nr_noise_sample_sec: float = Query(0.5,  ge=0.1, le=5.0, description="Segundos iniciales usados para estimar el perfil de ruido."),
    tonal_balance_bypass: bool = Query(True, description="Bypass del EQ inteligente de balance tonal automático (sin referencia)."),
    tonal_balance_amount: float = Query(1.0, ge=0.0, le=1.0, description="Mezcla 0..1 de las bandas sugeridas por el balance tonal automático."),
    tonal_balance_max_boost_db: float = Query(3.5, ge=0.0, le=12.0),
    tonal_balance_max_cut_db: float = Query(-4.5, ge=-12.0, le=0.0),
    tonal_balance_max_bands: int = Query(6, ge=1, le=12),
    output_format: str        = Query("mp3", pattern="^(wav|flac|mp3)$"),
    output_bit_depth: int     = Query(24, description="Bit depth de salida (WAV/FLAC): 16, 24 o 32 (float). Se aplica dither TPDF si baja de 32."),
    dither_mode: str          = Query("f_weighted", pattern="^(tpdf|high_shelf|f_weighted)$", description="Noise shaping del dither: tpdf, high_shelf, f_weighted (ISO 226 — default)"),
    preview_seconds: float    = Query(10.0,  ge=5.0,   le=120.0),
    platform_target: str      = Query(None,  pattern="^(spotify|youtube|apple_music|tidal|club|cd)$"),
):
    validate_audio_file(file.filename)
    data = await read_and_validate(file)
    tmp = os.path.join(UPLOAD_DIR, f"prev_{uuid.uuid4().hex}")
    try:
        with open(tmp, "wb") as f: f.write(data)
        # BUGFIX: process_audio() es la función más pesada de toda la API
        # (filtros, compresor, oversampling x4, etc). Llamarla directo acá
        # bloqueaba el event loop durante TODO el preview, congelando el
        # dashboard en vivo y cualquier otra request mientras tanto.
        result = await run_in_threadpool(
            process_audio,
            tmp,
            target_peak=target_peak,
            use_lufs_normalize=use_lufs_normalize,
            target_lufs=target_lufs,
            input_gain_db=input_gain_db,
            oversample_mode=oversample_mode,
            comp_stereo_link=comp_stereo_link,
            comp_threshold_db=comp_threshold_db,
            comp_ratio=comp_ratio,
            comp_attack_ms=comp_attack_ms,
            comp_release_ms=comp_release_ms,
            comp_makeup_db=comp_makeup_db,
            comp_pdr=comp_pdr,
            comp_pdr_hold_ms=comp_pdr_hold_ms,
            parallel_bypass=parallel_bypass,
            parallel_threshold_db=parallel_threshold_db,
            parallel_ratio=parallel_ratio,
            parallel_attack_ms=parallel_attack_ms,
            parallel_release_ms=parallel_release_ms,
            parallel_mix=parallel_mix,
            mb_low_crossover=mb_low_crossover,
            mb_high_crossover=mb_high_crossover,
            mb_low_threshold_db=mb_low_threshold_db,
            mb_low_ratio=mb_low_ratio,
            mb_low_attack_ms=mb_low_attack_ms,
            mb_low_release_ms=mb_low_release_ms,
            mb_low_makeup_db=mb_low_makeup_db,
            mb_mid_threshold_db=mb_mid_threshold_db,
            mb_mid_ratio=mb_mid_ratio,
            mb_mid_attack_ms=mb_mid_attack_ms,
            mb_mid_release_ms=mb_mid_release_ms,
            mb_mid_makeup_db=mb_mid_makeup_db,
            mb_high_threshold_db=mb_high_threshold_db,
            mb_high_ratio=mb_high_ratio,
            mb_high_attack_ms=mb_high_attack_ms,
            mb_high_release_ms=mb_high_release_ms,
            mb_high_makeup_db=mb_high_makeup_db,
            mb_pdr=mb_pdr,
            mb_pdr_hold_ms=mb_pdr_hold_ms,
            mb_bypass=mb_bypass,
            hp_cutoff=hp_cutoff,
            lp_bypass=lp_bypass,
            lp_cutoff=lp_cutoff,
            high_shelf_gain_db=high_shelf_gain_db,
            high_shelf_freq_hz=high_shelf_freq_hz,
            low_shelf_gain_db=low_shelf_gain_db,
            low_shelf_freq_hz=low_shelf_freq_hz,
            mb_stereo_bypass=mb_stereo_bypass,
            mb_stereo_low_width=mb_stereo_low_width,
            mb_stereo_mid_width=mb_stereo_mid_width,
            mb_stereo_high_width=mb_stereo_high_width,
            mb_stereo_low_crossover=mb_stereo_low_crossover,
            mb_stereo_high_crossover=mb_stereo_high_crossover,
            eq1_freq=eq1_freq, eq1_gain=eq1_gain, eq1_q=eq1_q,
            eq2_freq=eq2_freq, eq2_gain=eq2_gain, eq2_q=eq2_q,
            eq3_freq=eq3_freq, eq3_gain=eq3_gain, eq3_q=eq3_q,
            eq4_freq=eq4_freq, eq4_gain=eq4_gain, eq4_q=eq4_q,
            eq5_freq=eq5_freq, eq5_gain=eq5_gain, eq5_q=eq5_q,
            eq6_freq=eq6_freq, eq6_gain=eq6_gain, eq6_q=eq6_q,
            transient_attack=transient_attack,
            transient_sustain=transient_sustain,
            saturation_drive=saturation_drive,
            saturation_mode=saturation_mode,
            saturation_mix=saturation_mix,
            mid_gain_db=mid_gain_db,
            side_gain_db=side_gain_db,
            stereo_width_amount=stereo_width_amount,
            use_stereo_enhancer=use_stereo_enhancer,
            enhancer_bass_mono_freq=enhancer_bass_mono_freq,
            haas_delay_ms=haas_delay_ms,
            reverb_size=reverb_size,
            reverb_wet=reverb_wet,
            glue_bypass=glue_bypass,
            glue_threshold_db=glue_threshold_db,
            glue_ratio=glue_ratio,
            glue_attack_ms=glue_attack_ms,
            glue_release_ms=glue_release_ms,
            glue_makeup_db=glue_makeup_db,
            glue_pdr=glue_pdr,
            glue_pdr_hold_ms=glue_pdr_hold_ms,
            limiter_ceiling=limiter_ceiling,
            limiter_release_ms=limiter_release_ms,
            eq_mode=eq_mode,
            linear_phase_taps=linear_phase_taps,
            low_end_mono_freq=low_end_mono_freq,
            low_end_mono_amount=low_end_mono_amount,
            dyneq_bypass=dyneq_bypass,
            dyneq_freq=dyneq_freq,
            dyneq_q=dyneq_q,
            dyneq_threshold_db=dyneq_threshold_db,
            dyneq_ratio=dyneq_ratio,
            dyneq_attack_ms=dyneq_attack_ms,
            dyneq_release_ms=dyneq_release_ms,
            dyneq_max_reduction_db=dyneq_max_reduction_db,
            ms_eq_bypass=ms_eq_bypass,
            ms_mid_freq=ms_mid_freq, ms_mid_gain=ms_mid_gain, ms_mid_q=ms_mid_q,
            ms_side_freq=ms_side_freq, ms_side_gain=ms_side_gain, ms_side_q=ms_side_q,
            ms_comp_bypass=ms_comp_bypass,
            ms_comp_mid_threshold_db=ms_comp_mid_threshold_db, ms_comp_mid_ratio=ms_comp_mid_ratio,
            ms_comp_mid_attack_ms=ms_comp_mid_attack_ms, ms_comp_mid_release_ms=ms_comp_mid_release_ms,
            ms_comp_mid_makeup_db=ms_comp_mid_makeup_db,
            ms_comp_side_threshold_db=ms_comp_side_threshold_db, ms_comp_side_ratio=ms_comp_side_ratio,
            ms_comp_side_attack_ms=ms_comp_side_attack_ms, ms_comp_side_release_ms=ms_comp_side_release_ms,
            ms_comp_side_makeup_db=ms_comp_side_makeup_db,
            ms_comp_pdr=ms_comp_pdr,
            ms_comp_pdr_hold_ms=ms_comp_pdr_hold_ms,
            reso_bypass=reso_bypass,
            reso_freq=reso_freq,
            reso_q=reso_q,
            reso_threshold_db=reso_threshold_db,
            reso_ratio=reso_ratio,
            reso_attack_ms=reso_attack_ms,
            reso_release_ms=reso_release_ms,
            reso_max_reduction_db=reso_max_reduction_db,
            clipper_bypass=clipper_bypass,
            clipper_mode=clipper_mode,
            clipper_ceiling=clipper_ceiling,
            clipper_drive_db=clipper_drive_db,
            nr_bypass=nr_bypass,
            nr_strength=nr_strength,
            nr_noise_sample_sec=nr_noise_sample_sec,
            tonal_balance_bypass=tonal_balance_bypass,
            tonal_balance_amount=tonal_balance_amount,
            tonal_balance_max_boost_db=tonal_balance_max_boost_db,
            tonal_balance_max_cut_db=tonal_balance_max_cut_db,
            tonal_balance_max_bands=tonal_balance_max_bands,
            output_format=output_format,
            output_bit_depth=output_bit_depth,
            dither_mode=dither_mode,   # BUGFIX: faltaba — /preview siempre usaba f_weighted hardcodeado
            preview_seconds=preview_seconds,
            platform_target=platform_target,
        )
        mt = "audio/mpeg" if output_format == "mp3" else ("audio/flac" if output_format == "flac" else "audio/wav")
        return FileResponse(result["output_path"], media_type=mt, filename=f"preview.{output_format}")
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))
    finally:
        if os.path.exists(tmp): os.remove(tmp)

# ── Master async ──────────────────────────────────────────────────────────────
@app.post("/master", tags=["Mastering"])
async def master_async(
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(None),
    library_id: Optional[str]  = Form(None, description="Alternativa a 'file': id de un archivo ya guardado en /library"),
    target_peak: float        = Query(0.95,   ge=0.1,   le=1.0),
    use_lufs_normalize: bool  = Query(False),
    target_lufs: float        = Query(-14.0,  ge=-40.0, le=0.0),
    # Multiband con valores conservadores
    mb_low_crossover: float = Query(250.0, ge=20.0, le=2000.0),
    mb_high_crossover: float = Query(4000.0, ge=500.0, le=20000.0),
    mb_low_threshold_db: float = Query(-18.0, ge=-60.0, le=0.0),
    mb_low_ratio: float = Query(2.0, ge=1.0, le=20.0),
    mb_low_attack_ms: float = Query(20.0, ge=0.1, le=200.0),
    mb_low_release_ms: float = Query(150.0, ge=10.0, le=1000.0),
    mb_low_makeup_db: float = Query(0.0, ge=-12.0, le=24.0),
    mb_mid_threshold_db: float = Query(-18.0, ge=-60.0, le=0.0),
    mb_mid_ratio: float = Query(2.0, ge=1.0, le=20.0),
    mb_mid_attack_ms: float = Query(20.0, ge=0.1, le=200.0),
    mb_mid_release_ms: float = Query(150.0, ge=10.0, le=1000.0),
    mb_mid_makeup_db: float = Query(0.0, ge=-12.0, le=24.0),
    mb_high_threshold_db: float = Query(-18.0, ge=-60.0, le=0.0),
    mb_high_ratio: float = Query(2.0, ge=1.0, le=20.0),
    mb_high_attack_ms: float = Query(20.0, ge=0.1, le=200.0),
    mb_high_release_ms: float = Query(150.0, ge=10.0, le=1000.0),
    mb_high_makeup_db: float = Query(0.0, ge=-12.0, le=24.0),
    mb_bypass: bool = Query(False),
    mb_pdr: bool               = Query(True, description="Program-Dependent Release en el compresor multibanda"),
    mb_pdr_hold_ms: float      = Query(500.0, ge=50.0, le=2000.0),
    input_gain_db: float      = Query(0.0,    ge=-24.0, le=24.0),
    comp_threshold_db: float      = Query(-18.0, ge=-60.0, le=0.0),
    comp_ratio: float          = Query(4.0,   ge=1.0,   le=20.0),
    comp_attack_ms: float      = Query(10.0,  ge=0.1,   le=200.0),
    comp_release_ms: float     = Query(100.0, ge=10.0,  le=1000.0),
    comp_makeup_db: float      = Query(0.0,   ge=-12.0, le=24.0),
    comp_pdr: bool             = Query(True, description="Program-Dependent Release en el compresor de banda ancha/paralela"),
    comp_pdr_hold_ms: float    = Query(500.0, ge=50.0, le=2000.0),
    comp_stereo_link: bool     = Query(True, description="Linkea L/R en el compresor para preservar la imagen estéreo"),
    oversample_mode: str       = Query("quality", pattern="^(off|draft|fast|quality|ultra)$"),
    # Compresión paralela
    parallel_bypass: bool      = Query(True, description="Bypass para compresión paralela"),
    parallel_threshold_db: float = Query(-12.0, ge=-60.0, le=0.0),
    parallel_ratio: float      = Query(4.0, ge=1.0, le=20.0),
    parallel_attack_ms: float  = Query(10.0, ge=0.1, le=200.0),
    parallel_release_ms: float = Query(100.0, ge=5.0, le=1000.0),
    parallel_mix: float        = Query(0.0, ge=0.0, le=1.0, description="Mezcla dry/wet para compresión paralela (0..1)"),
    # EQ
    hp_cutoff: float          = Query(30.0,   ge=20.0,  le=500.0),
    lp_bypass: bool           = Query(True),
    lp_cutoff: float          = Query(18000.0, ge=1000.0, le=22000.0),
    high_shelf_gain_db: float = Query(2.0,    ge=-12.0, le=12.0),
    high_shelf_freq_hz: float  = Query(8000.0, ge=1000.0, le=20000.0),
    low_shelf_gain_db: float  = Query(0.0,    ge=-12.0, le=12.0),
    low_shelf_freq_hz: float  = Query(100.0,  ge=20.0,  le=2000.0),
    # Multiband Stereo Width
    mb_stereo_bypass: bool          = Query(True),
    mb_stereo_low_width: float      = Query(0.9,   ge=0.0, le=3.0),
    mb_stereo_mid_width: float      = Query(1.2,   ge=0.0, le=3.0),
    mb_stereo_high_width: float     = Query(1.5,   ge=0.0, le=3.0),
    mb_stereo_low_crossover: float  = Query(150.0, ge=20.0, le=2000.0),
    mb_stereo_high_crossover: float = Query(4000.0,ge=200.0, le=20000.0),
    eq1_freq: float = Query(100.0, ge=20.0, le=20000.0), eq1_gain: float = Query(0.0, ge=-12.0, le=12.0), eq1_q: float = Query(1.0, ge=0.1, le=30.0),
    eq2_freq: float = Query(500.0, ge=20.0, le=20000.0), eq2_gain: float = Query(0.0, ge=-12.0, le=12.0), eq2_q: float = Query(1.0, ge=0.1, le=30.0),
    eq3_freq: float = Query(2000.0, ge=20.0, le=20000.0), eq3_gain: float = Query(0.0, ge=-12.0, le=12.0), eq3_q: float = Query(1.0, ge=0.1, le=30.0),
    eq4_freq: float = Query(8000.0, ge=20.0, le=20000.0), eq4_gain: float = Query(0.0, ge=-12.0, le=12.0), eq4_q: float = Query(1.0, ge=0.1, le=30.0),
    eq5_freq: float = Query(200.0,  ge=20.0, le=20000.0), eq5_gain: float = Query(0.0, ge=-12.0, le=12.0), eq5_q: float = Query(1.0, ge=0.1, le=30.0),
    eq6_freq: float = Query(1000.0, ge=20.0, le=20000.0), eq6_gain: float = Query(0.0, ge=-12.0, le=12.0), eq6_q: float = Query(1.0, ge=0.1, le=30.0),
    transient_attack: float   = Query(0.0,   ge=-1.0,  le=1.0),
    transient_sustain: float  = Query(0.0,   ge=-1.0,  le=1.0),
    saturation_drive: float   = Query(0.0,   ge=0.0,   le=1.0),
    saturation_mode: str      = Query("tape", pattern="^(tape|tube|analog)$"),
    saturation_mix: float     = Query(1.0,   ge=0.0,   le=1.0),
    mid_gain_db: float        = Query(0.0,   ge=-12.0, le=12.0),
    side_gain_db: float       = Query(0.0,   ge=-18.0, le=18.0),
    stereo_width_amount: float = Query(1.2,  ge=0.0,   le=3.0),
    use_stereo_enhancer: bool  = Query(False),
    enhancer_bass_mono_freq: float = Query(120.0),
    haas_delay_ms: float      = Query(0.0,   ge=0.0,   le=30.0),
    reverb_size: float        = Query(0.3,   ge=0.05,  le=2.0),
    reverb_wet: float         = Query(0.0,   ge=0.0,   le=1.0),
    glue_bypass: bool         = Query(True),
    glue_threshold_db: float  = Query(-4.0,  ge=-24.0, le=0.0),
    glue_ratio: float         = Query(2.0,   ge=1.0,   le=10.0),
    glue_attack_ms: float     = Query(30.0,  ge=0.1,   le=200.0),
    glue_release_ms: float    = Query(120.0, ge=10.0,  le=1000.0),
    glue_makeup_db: float     = Query(0.0,   ge=-12.0, le=12.0),
    glue_pdr: bool            = Query(True, description="Program-Dependent Release en el glue compressor"),
    glue_pdr_hold_ms: float   = Query(500.0, ge=50.0, le=2000.0),
    limiter_ceiling: float    = Query(0.95,  ge=0.5,   le=1.0),
    limiter_release_ms: float = Query(50.0,  ge=1.0,   le=500.0),
    # EQ de fase lineal (FIR) / Dynamic EQ / Low-End Mono Maker dedicado
    eq_mode: str              = Query("iir", pattern="^(iir|linear_phase)$"),
    linear_phase_taps: int    = Query(2049, ge=257, le=8193),
    low_end_mono_freq: float  = Query(120.0, ge=40.0, le=300.0),
    low_end_mono_amount: float = Query(0.0, ge=0.0, le=1.0),
    dyneq_bypass: bool        = Query(True),
    dyneq_freq: float         = Query(3000.0, ge=200.0, le=16000.0),
    dyneq_q: float            = Query(2.5,   ge=0.5,  le=12.0),
    dyneq_threshold_db: float = Query(-18.0, ge=-60.0, le=0.0),
    dyneq_ratio: float        = Query(3.0,   ge=1.0,  le=20.0),
    dyneq_attack_ms: float    = Query(3.0,   ge=0.1,  le=100.0),
    dyneq_release_ms: float   = Query(80.0,  ge=5.0,  le=1000.0),
    dyneq_max_reduction_db: float = Query(12.0, ge=0.0, le=30.0),
    ms_eq_bypass: bool        = Query(True),
    ms_mid_freq: float        = Query(250.0,  ge=20.0,  le=2000.0),
    ms_mid_gain: float        = Query(0.0,    ge=-12.0, le=12.0),
    ms_mid_q: float           = Query(1.0,    ge=0.1,   le=10.0),
    ms_side_freq: float       = Query(8000.0, ge=1000.0, le=20000.0),
    ms_side_gain: float       = Query(0.0,    ge=-12.0, le=12.0),
    ms_side_q: float          = Query(1.0,    ge=0.1,   le=10.0),
    ms_comp_bypass: bool      = Query(True),
    ms_comp_mid_threshold_db: float = Query(-18.0, ge=-60.0, le=0.0),
    ms_comp_mid_ratio: float        = Query(2.0,   ge=1.0,  le=20.0),
    ms_comp_mid_attack_ms: float    = Query(15.0,  ge=0.1,  le=200.0),
    ms_comp_mid_release_ms: float   = Query(120.0, ge=5.0,  le=2000.0),
    ms_comp_mid_makeup_db: float    = Query(0.0,   ge=0.0,  le=24.0),
    ms_comp_side_threshold_db: float = Query(-18.0, ge=-60.0, le=0.0),
    ms_comp_side_ratio: float        = Query(2.0,   ge=1.0,  le=20.0),
    ms_comp_side_attack_ms: float    = Query(15.0,  ge=0.1,  le=200.0),
    ms_comp_side_release_ms: float   = Query(120.0, ge=5.0,  le=2000.0),
    ms_comp_side_makeup_db: float    = Query(0.0,   ge=0.0,  le=24.0),
    ms_comp_pdr: bool                = Query(True, description="Program-Dependent Release en el compresor M/S"),
    ms_comp_pdr_hold_ms: float       = Query(500.0, ge=50.0, le=2000.0),
    reso_bypass: bool         = Query(True),
    reso_freq: float          = Query(1200.0, ge=200.0, le=16000.0),
    reso_q: float             = Query(3.0,    ge=0.5,   le=12.0),
    reso_threshold_db: float  = Query(-18.0,  ge=-60.0, le=0.0),
    reso_ratio: float         = Query(3.0,    ge=1.0,   le=20.0),
    reso_attack_ms: float     = Query(5.0,    ge=0.1,   le=100.0),
    reso_release_ms: float    = Query(100.0,  ge=5.0,   le=1000.0),
    reso_max_reduction_db: float = Query(8.0, ge=0.0,   le=30.0),
    clipper_bypass: bool      = Query(True),
    clipper_mode: str         = Query("soft", pattern="^(soft|hard)$"),
    clipper_ceiling: float    = Query(0.98,   ge=0.1,   le=1.0),
    clipper_drive_db: float   = Query(0.0,    ge=0.0,   le=24.0),
    nr_bypass: bool           = Query(True,  description="Desactivar para aplicar reducción de ruido antes de la cadena."),
    nr_strength: float        = Query(0.5,   ge=0.0, le=1.0, description="Intensidad de la reducción de ruido (0=nada, 1=máximo)."),
    nr_noise_sample_sec: float = Query(0.5,  ge=0.1, le=5.0, description="Segundos iniciales usados para estimar el perfil de ruido."),
    tonal_balance_bypass: bool = Query(True, description="Bypass del EQ inteligente de balance tonal automático (sin referencia)."),
    tonal_balance_amount: float = Query(1.0, ge=0.0, le=1.0, description="Mezcla 0..1 de las bandas sugeridas por el balance tonal automático."),
    tonal_balance_max_boost_db: float = Query(3.5, ge=0.0, le=12.0),
    tonal_balance_max_cut_db: float = Query(-4.5, ge=-12.0, le=0.0),
    tonal_balance_max_bands: int = Query(6, ge=1, le=12),
    output_format: str        = Query("wav",  pattern="^(wav|flac|mp3)$"),
    output_bit_depth: int     = Query(24, description="Bit depth de salida (WAV/FLAC): 16, 24 o 32 (float). Se aplica dither TPDF si baja de 32."),
    dither_mode: str          = Query("f_weighted", pattern="^(tpdf|high_shelf|f_weighted)$", description="Noise shaping del dither: tpdf, high_shelf, f_weighted (ISO 226 — default)"),
    platform_target: str      = Query(None,   pattern="^(spotify|youtube|apple_music|tidal|club|cd)$"),
):
    data, filename = await resolve_input_source(file, library_id)
    job_id = uuid.uuid4().hex
    input_path = os.path.join(UPLOAD_DIR, f"{job_id}_{filename}")
    with open(input_path, "wb") as f: f.write(data)

    params = dict(
        target_peak=target_peak,
        use_lufs_normalize=use_lufs_normalize,
        target_lufs=target_lufs,
        input_gain_db=input_gain_db,
        oversample_mode=oversample_mode,
        comp_stereo_link=comp_stereo_link,
        comp_threshold_db=comp_threshold_db,
        comp_ratio=comp_ratio,
        comp_attack_ms=comp_attack_ms,
        comp_release_ms=comp_release_ms,
        comp_makeup_db=comp_makeup_db,
        comp_pdr=comp_pdr,
        comp_pdr_hold_ms=comp_pdr_hold_ms,
        parallel_bypass=parallel_bypass,
        parallel_threshold_db=parallel_threshold_db,
        parallel_ratio=parallel_ratio,
        parallel_attack_ms=parallel_attack_ms,
        parallel_release_ms=parallel_release_ms,
        parallel_mix=parallel_mix,
        mb_low_crossover=mb_low_crossover,
        mb_high_crossover=mb_high_crossover,
        mb_low_threshold_db=mb_low_threshold_db,
        mb_low_ratio=mb_low_ratio,
        mb_low_attack_ms=mb_low_attack_ms,
        mb_low_release_ms=mb_low_release_ms,
        mb_low_makeup_db=mb_low_makeup_db,
        mb_mid_threshold_db=mb_mid_threshold_db,
        mb_mid_ratio=mb_mid_ratio,
        mb_mid_attack_ms=mb_mid_attack_ms,
        mb_mid_release_ms=mb_mid_release_ms,
        mb_mid_makeup_db=mb_mid_makeup_db,
        mb_high_threshold_db=mb_high_threshold_db,
        mb_high_ratio=mb_high_ratio,
        mb_high_attack_ms=mb_high_attack_ms,
        mb_high_release_ms=mb_high_release_ms,
        mb_high_makeup_db=mb_high_makeup_db,
        mb_pdr=mb_pdr,
        mb_pdr_hold_ms=mb_pdr_hold_ms,
        mb_bypass=mb_bypass,
        hp_cutoff=hp_cutoff,
        lp_bypass=lp_bypass,
        lp_cutoff=lp_cutoff,
        high_shelf_gain_db=high_shelf_gain_db,
        high_shelf_freq_hz=high_shelf_freq_hz,
        low_shelf_gain_db=low_shelf_gain_db,
        low_shelf_freq_hz=low_shelf_freq_hz,
        mb_stereo_bypass=mb_stereo_bypass,
        mb_stereo_low_width=mb_stereo_low_width,
        mb_stereo_mid_width=mb_stereo_mid_width,
        mb_stereo_high_width=mb_stereo_high_width,
        mb_stereo_low_crossover=mb_stereo_low_crossover,
        mb_stereo_high_crossover=mb_stereo_high_crossover,
        eq1_freq=eq1_freq, eq1_gain=eq1_gain, eq1_q=eq1_q,
        eq2_freq=eq2_freq, eq2_gain=eq2_gain, eq2_q=eq2_q,
        eq3_freq=eq3_freq, eq3_gain=eq3_gain, eq3_q=eq3_q,
        eq4_freq=eq4_freq, eq4_gain=eq4_gain, eq4_q=eq4_q,
        eq5_freq=eq5_freq, eq5_gain=eq5_gain, eq5_q=eq5_q,
        eq6_freq=eq6_freq, eq6_gain=eq6_gain, eq6_q=eq6_q,
        transient_attack=transient_attack,
        transient_sustain=transient_sustain,
        saturation_drive=saturation_drive,
        saturation_mode=saturation_mode,
        saturation_mix=saturation_mix,
        mid_gain_db=mid_gain_db,
        side_gain_db=side_gain_db,
        stereo_width_amount=stereo_width_amount,
        use_stereo_enhancer=use_stereo_enhancer,
        enhancer_bass_mono_freq=enhancer_bass_mono_freq,
        haas_delay_ms=haas_delay_ms,
        reverb_size=reverb_size,
        reverb_wet=reverb_wet,
        glue_bypass=glue_bypass,
        glue_threshold_db=glue_threshold_db,
        glue_ratio=glue_ratio,
        glue_attack_ms=glue_attack_ms,
        glue_release_ms=glue_release_ms,
        glue_makeup_db=glue_makeup_db,
        glue_pdr=glue_pdr,
        glue_pdr_hold_ms=glue_pdr_hold_ms,
        limiter_ceiling=limiter_ceiling,
        limiter_release_ms=limiter_release_ms,
        eq_mode=eq_mode,
        linear_phase_taps=linear_phase_taps,
        low_end_mono_freq=low_end_mono_freq,
        low_end_mono_amount=low_end_mono_amount,
        dyneq_bypass=dyneq_bypass,
        dyneq_freq=dyneq_freq,
        dyneq_q=dyneq_q,
        dyneq_threshold_db=dyneq_threshold_db,
        dyneq_ratio=dyneq_ratio,
        dyneq_attack_ms=dyneq_attack_ms,
        dyneq_release_ms=dyneq_release_ms,
        dyneq_max_reduction_db=dyneq_max_reduction_db,
        ms_eq_bypass=ms_eq_bypass,
        ms_mid_freq=ms_mid_freq, ms_mid_gain=ms_mid_gain, ms_mid_q=ms_mid_q,
        ms_side_freq=ms_side_freq, ms_side_gain=ms_side_gain, ms_side_q=ms_side_q,
        ms_comp_bypass=ms_comp_bypass,
        ms_comp_mid_threshold_db=ms_comp_mid_threshold_db, ms_comp_mid_ratio=ms_comp_mid_ratio,
        ms_comp_mid_attack_ms=ms_comp_mid_attack_ms, ms_comp_mid_release_ms=ms_comp_mid_release_ms,
        ms_comp_mid_makeup_db=ms_comp_mid_makeup_db,
        ms_comp_side_threshold_db=ms_comp_side_threshold_db, ms_comp_side_ratio=ms_comp_side_ratio,
        ms_comp_side_attack_ms=ms_comp_side_attack_ms, ms_comp_side_release_ms=ms_comp_side_release_ms,
        ms_comp_side_makeup_db=ms_comp_side_makeup_db,
        ms_comp_pdr=ms_comp_pdr,
        ms_comp_pdr_hold_ms=ms_comp_pdr_hold_ms,
        reso_bypass=reso_bypass,
        reso_freq=reso_freq,
        reso_q=reso_q,
        reso_threshold_db=reso_threshold_db,
        reso_ratio=reso_ratio,
        reso_attack_ms=reso_attack_ms,
        reso_release_ms=reso_release_ms,
        reso_max_reduction_db=reso_max_reduction_db,
        clipper_bypass=clipper_bypass,
        clipper_mode=clipper_mode,
        clipper_ceiling=clipper_ceiling,
        clipper_drive_db=clipper_drive_db,
        nr_bypass=nr_bypass,
        nr_strength=nr_strength,
        nr_noise_sample_sec=nr_noise_sample_sec,
        tonal_balance_bypass=tonal_balance_bypass,
        tonal_balance_amount=tonal_balance_amount,
        tonal_balance_max_boost_db=tonal_balance_max_boost_db,
        tonal_balance_max_cut_db=tonal_balance_max_cut_db,
        tonal_balance_max_bands=tonal_balance_max_bands,
        output_format=output_format,
        output_bit_depth=output_bit_depth,
        dither_mode=dither_mode,
        platform_target=platform_target,
    )
    duration = _get_input_duration(input_path)
    job_params = dict(params)
    if duration is not None:
        job_params["_input_duration_sec"] = duration
    jobs.create_job(job_id, {"status": "queued", "filename": filename, "created_at": time.time(), "params": job_params, "progress": 0, "stage": "En cola"})
    background_tasks.add_task(run_mastering_job, job_id, input_path, params)
    return {"job_id": job_id, "status": "queued", "poll_url": f"/job/{job_id}"}

# ── Master sync ──────────────────────────────────────────────────────────────
@app.post("/master/sync", tags=["Mastering"])
async def master_sync(
    file: UploadFile = File(...),
    target_peak: float        = Query(0.95,   ge=0.1,   le=1.0),
    use_lufs_normalize: bool  = Query(False),
    target_lufs: float        = Query(-14.0,  ge=-40.0, le=0.0),
    # Multiband con valores conservadores
    mb_low_crossover: float = Query(250.0, ge=20.0, le=2000.0),
    mb_high_crossover: float = Query(4000.0, ge=500.0, le=20000.0),
    mb_low_threshold_db: float = Query(-18.0, ge=-60.0, le=0.0),
    mb_low_ratio: float = Query(2.0, ge=1.0, le=20.0),
    mb_low_attack_ms: float = Query(20.0, ge=0.1, le=200.0),
    mb_low_release_ms: float = Query(150.0, ge=10.0, le=1000.0),
    mb_low_makeup_db: float = Query(0.0, ge=-12.0, le=24.0),
    mb_mid_threshold_db: float = Query(-18.0, ge=-60.0, le=0.0),
    mb_mid_ratio: float = Query(2.0, ge=1.0, le=20.0),
    mb_mid_attack_ms: float = Query(20.0, ge=0.1, le=200.0),
    mb_mid_release_ms: float = Query(150.0, ge=10.0, le=1000.0),
    mb_mid_makeup_db: float = Query(0.0, ge=-12.0, le=24.0),
    mb_high_threshold_db: float = Query(-18.0, ge=-60.0, le=0.0),
    mb_high_ratio: float = Query(2.0, ge=1.0, le=20.0),
    mb_high_attack_ms: float = Query(20.0, ge=0.1, le=200.0),
    mb_high_release_ms: float = Query(150.0, ge=10.0, le=1000.0),
    mb_high_makeup_db: float = Query(0.0, ge=-12.0, le=24.0),
    mb_bypass: bool = Query(False),
    mb_pdr: bool               = Query(True, description="Program-Dependent Release en el compresor multibanda"),
    mb_pdr_hold_ms: float      = Query(500.0, ge=50.0, le=2000.0),
    input_gain_db: float      = Query(0.0,    ge=-24.0, le=24.0),
    comp_threshold_db: float      = Query(-18.0, ge=-60.0, le=0.0),
    comp_ratio: float          = Query(4.0,   ge=1.0,   le=20.0),
    comp_attack_ms: float      = Query(10.0,  ge=0.1,   le=200.0),
    comp_release_ms: float     = Query(100.0, ge=10.0,  le=1000.0),
    comp_makeup_db: float      = Query(0.0,   ge=-12.0, le=24.0),
    comp_pdr: bool             = Query(True, description="Program-Dependent Release en el compresor de banda ancha/paralela"),
    comp_pdr_hold_ms: float    = Query(500.0, ge=50.0, le=2000.0),
    comp_stereo_link: bool     = Query(True, description="Linkea L/R en el compresor para preservar la imagen estéreo"),
    oversample_mode: str       = Query("quality", pattern="^(off|draft|fast|quality|ultra)$"),
    # Compresión paralela
    parallel_bypass: bool      = Query(True, description="Bypass para compresión paralela"),
    parallel_threshold_db: float = Query(-12.0, ge=-60.0, le=0.0),
    parallel_ratio: float      = Query(4.0, ge=1.0, le=20.0),
    parallel_attack_ms: float  = Query(10.0, ge=0.1, le=200.0),
    parallel_release_ms: float = Query(100.0, ge=5.0, le=1000.0),
    parallel_mix: float        = Query(0.0, ge=0.0, le=1.0, description="Mezcla dry/wet para compresión paralela (0..1)"),
    # EQ
    hp_cutoff: float          = Query(30.0,   ge=20.0,  le=500.0),
    lp_bypass: bool           = Query(True),
    lp_cutoff: float          = Query(18000.0, ge=1000.0, le=22000.0),
    high_shelf_gain_db: float = Query(2.0,    ge=-12.0, le=12.0),
    high_shelf_freq_hz: float  = Query(8000.0, ge=1000.0, le=20000.0),
    low_shelf_gain_db: float  = Query(0.0,    ge=-12.0, le=12.0),
    low_shelf_freq_hz: float  = Query(100.0,  ge=20.0,  le=2000.0),
    # Multiband Stereo Width
    mb_stereo_bypass: bool          = Query(True),
    mb_stereo_low_width: float      = Query(0.9,   ge=0.0, le=3.0),
    mb_stereo_mid_width: float      = Query(1.2,   ge=0.0, le=3.0),
    mb_stereo_high_width: float     = Query(1.5,   ge=0.0, le=3.0),
    mb_stereo_low_crossover: float  = Query(150.0, ge=20.0, le=2000.0),
    mb_stereo_high_crossover: float = Query(4000.0,ge=200.0, le=20000.0),
    eq1_freq: float = Query(100.0, ge=20.0, le=20000.0), eq1_gain: float = Query(0.0, ge=-12.0, le=12.0), eq1_q: float = Query(1.0, ge=0.1, le=30.0),
    eq2_freq: float = Query(500.0, ge=20.0, le=20000.0), eq2_gain: float = Query(0.0, ge=-12.0, le=12.0), eq2_q: float = Query(1.0, ge=0.1, le=30.0),
    eq3_freq: float = Query(2000.0, ge=20.0, le=20000.0), eq3_gain: float = Query(0.0, ge=-12.0, le=12.0), eq3_q: float = Query(1.0, ge=0.1, le=30.0),
    eq4_freq: float = Query(8000.0, ge=20.0, le=20000.0), eq4_gain: float = Query(0.0, ge=-12.0, le=12.0), eq4_q: float = Query(1.0, ge=0.1, le=30.0),
    eq5_freq: float = Query(200.0,  ge=20.0, le=20000.0), eq5_gain: float = Query(0.0, ge=-12.0, le=12.0), eq5_q: float = Query(1.0, ge=0.1, le=30.0),
    eq6_freq: float = Query(1000.0, ge=20.0, le=20000.0), eq6_gain: float = Query(0.0, ge=-12.0, le=12.0), eq6_q: float = Query(1.0, ge=0.1, le=30.0),
    transient_attack: float   = Query(0.0,   ge=-1.0,  le=1.0),
    transient_sustain: float  = Query(0.0,   ge=-1.0,  le=1.0),
    saturation_drive: float   = Query(0.0,   ge=0.0,   le=1.0),
    saturation_mode: str      = Query("tape", pattern="^(tape|tube|analog)$"),
    saturation_mix: float     = Query(1.0,   ge=0.0,   le=1.0),
    mid_gain_db: float        = Query(0.0,   ge=-12.0, le=12.0),
    side_gain_db: float       = Query(0.0,   ge=-18.0, le=18.0),
    stereo_width_amount: float = Query(1.2,  ge=0.0,   le=3.0),
    use_stereo_enhancer: bool  = Query(False),
    enhancer_bass_mono_freq: float = Query(120.0),
    haas_delay_ms: float      = Query(0.0,   ge=0.0,   le=30.0),
    reverb_size: float        = Query(0.3,   ge=0.05,  le=2.0),
    reverb_wet: float         = Query(0.0,   ge=0.0,   le=1.0),
    glue_bypass: bool         = Query(True),
    glue_threshold_db: float  = Query(-4.0,  ge=-24.0, le=0.0),
    glue_ratio: float         = Query(2.0,   ge=1.0,   le=10.0),
    glue_attack_ms: float     = Query(30.0,  ge=0.1,   le=200.0),
    glue_release_ms: float    = Query(120.0, ge=10.0,  le=1000.0),
    glue_makeup_db: float     = Query(0.0,   ge=-12.0, le=12.0),
    glue_pdr: bool            = Query(True, description="Program-Dependent Release en el glue compressor"),
    glue_pdr_hold_ms: float   = Query(500.0, ge=50.0, le=2000.0),
    limiter_ceiling: float    = Query(0.95,  ge=0.5,   le=1.0),
    limiter_release_ms: float = Query(50.0,  ge=1.0,   le=500.0),
    # EQ de fase lineal (FIR) / Dynamic EQ / Low-End Mono Maker dedicado
    eq_mode: str              = Query("iir", pattern="^(iir|linear_phase)$"),
    linear_phase_taps: int    = Query(2049, ge=257, le=8193),
    low_end_mono_freq: float  = Query(120.0, ge=40.0, le=300.0),
    low_end_mono_amount: float = Query(0.0, ge=0.0, le=1.0),
    dyneq_bypass: bool        = Query(True),
    dyneq_freq: float         = Query(3000.0, ge=200.0, le=16000.0),
    dyneq_q: float            = Query(2.5,   ge=0.5,  le=12.0),
    dyneq_threshold_db: float = Query(-18.0, ge=-60.0, le=0.0),
    dyneq_ratio: float        = Query(3.0,   ge=1.0,  le=20.0),
    dyneq_attack_ms: float    = Query(3.0,   ge=0.1,  le=100.0),
    dyneq_release_ms: float   = Query(80.0,  ge=5.0,  le=1000.0),
    dyneq_max_reduction_db: float = Query(12.0, ge=0.0, le=30.0),
    ms_eq_bypass: bool        = Query(True),
    ms_mid_freq: float        = Query(250.0,  ge=20.0,  le=2000.0),
    ms_mid_gain: float        = Query(0.0,    ge=-12.0, le=12.0),
    ms_mid_q: float           = Query(1.0,    ge=0.1,   le=10.0),
    ms_side_freq: float       = Query(8000.0, ge=1000.0, le=20000.0),
    ms_side_gain: float       = Query(0.0,    ge=-12.0, le=12.0),
    ms_side_q: float          = Query(1.0,    ge=0.1,   le=10.0),
    ms_comp_bypass: bool      = Query(True),
    ms_comp_mid_threshold_db: float = Query(-18.0, ge=-60.0, le=0.0),
    ms_comp_mid_ratio: float        = Query(2.0,   ge=1.0,  le=20.0),
    ms_comp_mid_attack_ms: float    = Query(15.0,  ge=0.1,  le=200.0),
    ms_comp_mid_release_ms: float   = Query(120.0, ge=5.0,  le=2000.0),
    ms_comp_mid_makeup_db: float    = Query(0.0,   ge=0.0,  le=24.0),
    ms_comp_side_threshold_db: float = Query(-18.0, ge=-60.0, le=0.0),
    ms_comp_side_ratio: float        = Query(2.0,   ge=1.0,  le=20.0),
    ms_comp_side_attack_ms: float    = Query(15.0,  ge=0.1,  le=200.0),
    ms_comp_side_release_ms: float   = Query(120.0, ge=5.0,  le=2000.0),
    ms_comp_side_makeup_db: float    = Query(0.0,   ge=0.0,  le=24.0),
    ms_comp_pdr: bool                = Query(True, description="Program-Dependent Release en el compresor M/S"),
    ms_comp_pdr_hold_ms: float       = Query(500.0, ge=50.0, le=2000.0),
    reso_bypass: bool         = Query(True),
    reso_freq: float          = Query(1200.0, ge=200.0, le=16000.0),
    reso_q: float             = Query(3.0,    ge=0.5,   le=12.0),
    reso_threshold_db: float  = Query(-18.0,  ge=-60.0, le=0.0),
    reso_ratio: float         = Query(3.0,    ge=1.0,   le=20.0),
    reso_attack_ms: float     = Query(5.0,    ge=0.1,   le=100.0),
    reso_release_ms: float    = Query(100.0,  ge=5.0,   le=1000.0),
    reso_max_reduction_db: float = Query(8.0, ge=0.0,   le=30.0),
    clipper_bypass: bool      = Query(True),
    clipper_mode: str         = Query("soft", pattern="^(soft|hard)$"),
    clipper_ceiling: float    = Query(0.98,   ge=0.1,   le=1.0),
    clipper_drive_db: float   = Query(0.0,    ge=0.0,   le=24.0),
    nr_bypass: bool           = Query(True,  description="Desactivar para aplicar reducción de ruido antes de la cadena."),
    nr_strength: float        = Query(0.5,   ge=0.0, le=1.0, description="Intensidad de la reducción de ruido (0=nada, 1=máximo)."),
    nr_noise_sample_sec: float = Query(0.5,  ge=0.1, le=5.0, description="Segundos iniciales usados para estimar el perfil de ruido."),
    output_format: str        = Query("wav",  pattern="^(wav|flac|mp3)$"),
    output_bit_depth: int     = Query(24, description="Bit depth de salida (WAV/FLAC): 16, 24 o 32 (float). Se aplica dither TPDF si baja de 32."),
    dither_mode: str          = Query("f_weighted", pattern="^(tpdf|high_shelf|f_weighted)$", description="Noise shaping del dither: tpdf, high_shelf, f_weighted (ISO 226 — default)"),
    platform_target: str      = Query(None,   pattern="^(spotify|youtube|apple_music|tidal|club|cd)$"),
):
    validate_audio_file(file.filename)
    data = await read_and_validate(file)
    tmp = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}_{file.filename}")
    try:
        cleanup_old()
        with open(tmp, "wb") as f: f.write(data)
        # BUGFIX: mismo problema de bloqueo del event loop que en /preview.
        result = await run_in_threadpool(
            process_audio,
            tmp,
            target_peak=target_peak,
            use_lufs_normalize=use_lufs_normalize,
            target_lufs=target_lufs,
            input_gain_db=input_gain_db,
            oversample_mode=oversample_mode,
            comp_stereo_link=comp_stereo_link,
            comp_threshold_db=comp_threshold_db,
            comp_ratio=comp_ratio,
            comp_attack_ms=comp_attack_ms,
            comp_release_ms=comp_release_ms,
            comp_makeup_db=comp_makeup_db,
            comp_pdr=comp_pdr,
            comp_pdr_hold_ms=comp_pdr_hold_ms,
            mb_low_crossover=mb_low_crossover,
            mb_high_crossover=mb_high_crossover,
            mb_low_threshold_db=mb_low_threshold_db,
            mb_low_ratio=mb_low_ratio,
            mb_low_attack_ms=mb_low_attack_ms,
            mb_low_release_ms=mb_low_release_ms,
            mb_low_makeup_db=mb_low_makeup_db,
            mb_mid_threshold_db=mb_mid_threshold_db,
            mb_mid_ratio=mb_mid_ratio,
            mb_mid_attack_ms=mb_mid_attack_ms,
            mb_mid_release_ms=mb_mid_release_ms,
            mb_mid_makeup_db=mb_mid_makeup_db,
            mb_high_threshold_db=mb_high_threshold_db,
            mb_high_ratio=mb_high_ratio,
            mb_high_attack_ms=mb_high_attack_ms,
            mb_high_release_ms=mb_high_release_ms,
            mb_high_makeup_db=mb_high_makeup_db,
            mb_pdr=mb_pdr,
            mb_pdr_hold_ms=mb_pdr_hold_ms,
            mb_bypass=mb_bypass,
            hp_cutoff=hp_cutoff,
            lp_bypass=lp_bypass,
            lp_cutoff=lp_cutoff,
            high_shelf_gain_db=high_shelf_gain_db,
            high_shelf_freq_hz=high_shelf_freq_hz,
            low_shelf_gain_db=low_shelf_gain_db,
            low_shelf_freq_hz=low_shelf_freq_hz,
            mb_stereo_bypass=mb_stereo_bypass,
            mb_stereo_low_width=mb_stereo_low_width,
            mb_stereo_mid_width=mb_stereo_mid_width,
            mb_stereo_high_width=mb_stereo_high_width,
            mb_stereo_low_crossover=mb_stereo_low_crossover,
            mb_stereo_high_crossover=mb_stereo_high_crossover,
            eq1_freq=eq1_freq, eq1_gain=eq1_gain, eq1_q=eq1_q,
            eq2_freq=eq2_freq, eq2_gain=eq2_gain, eq2_q=eq2_q,
            eq3_freq=eq3_freq, eq3_gain=eq3_gain, eq3_q=eq3_q,
            eq4_freq=eq4_freq, eq4_gain=eq4_gain, eq4_q=eq4_q,
            eq5_freq=eq5_freq, eq5_gain=eq5_gain, eq5_q=eq5_q,
            eq6_freq=eq6_freq, eq6_gain=eq6_gain, eq6_q=eq6_q,
            transient_attack=transient_attack,
            transient_sustain=transient_sustain,
            saturation_drive=saturation_drive,
            saturation_mode=saturation_mode,
            saturation_mix=saturation_mix,
            mid_gain_db=mid_gain_db,
            side_gain_db=side_gain_db,
            stereo_width_amount=stereo_width_amount,
            use_stereo_enhancer=use_stereo_enhancer,
            enhancer_bass_mono_freq=enhancer_bass_mono_freq,
            haas_delay_ms=haas_delay_ms,
            reverb_size=reverb_size,
            reverb_wet=reverb_wet,
            glue_bypass=glue_bypass,
            glue_threshold_db=glue_threshold_db,
            glue_ratio=glue_ratio,
            glue_attack_ms=glue_attack_ms,
            glue_release_ms=glue_release_ms,
            glue_makeup_db=glue_makeup_db,
            glue_pdr=glue_pdr,
            glue_pdr_hold_ms=glue_pdr_hold_ms,
            limiter_ceiling=limiter_ceiling,
            limiter_release_ms=limiter_release_ms,
            eq_mode=eq_mode,
            linear_phase_taps=linear_phase_taps,
            low_end_mono_freq=low_end_mono_freq,
            low_end_mono_amount=low_end_mono_amount,
            dyneq_bypass=dyneq_bypass,
            dyneq_freq=dyneq_freq,
            dyneq_q=dyneq_q,
            dyneq_threshold_db=dyneq_threshold_db,
            dyneq_ratio=dyneq_ratio,
            dyneq_attack_ms=dyneq_attack_ms,
            dyneq_release_ms=dyneq_release_ms,
            dyneq_max_reduction_db=dyneq_max_reduction_db,
            ms_eq_bypass=ms_eq_bypass,
            ms_mid_freq=ms_mid_freq, ms_mid_gain=ms_mid_gain, ms_mid_q=ms_mid_q,
            ms_side_freq=ms_side_freq, ms_side_gain=ms_side_gain, ms_side_q=ms_side_q,
            ms_comp_bypass=ms_comp_bypass,
            ms_comp_mid_threshold_db=ms_comp_mid_threshold_db, ms_comp_mid_ratio=ms_comp_mid_ratio,
            ms_comp_mid_attack_ms=ms_comp_mid_attack_ms, ms_comp_mid_release_ms=ms_comp_mid_release_ms,
            ms_comp_mid_makeup_db=ms_comp_mid_makeup_db,
            ms_comp_side_threshold_db=ms_comp_side_threshold_db, ms_comp_side_ratio=ms_comp_side_ratio,
            ms_comp_side_attack_ms=ms_comp_side_attack_ms, ms_comp_side_release_ms=ms_comp_side_release_ms,
            ms_comp_side_makeup_db=ms_comp_side_makeup_db,
            ms_comp_pdr=ms_comp_pdr,
            ms_comp_pdr_hold_ms=ms_comp_pdr_hold_ms,
            reso_bypass=reso_bypass,
            reso_freq=reso_freq,
            reso_q=reso_q,
            reso_threshold_db=reso_threshold_db,
            reso_ratio=reso_ratio,
            reso_attack_ms=reso_attack_ms,
            reso_release_ms=reso_release_ms,
            reso_max_reduction_db=reso_max_reduction_db,
            clipper_bypass=clipper_bypass,
            clipper_mode=clipper_mode,
            clipper_ceiling=clipper_ceiling,
            clipper_drive_db=clipper_drive_db,
            nr_bypass=nr_bypass,
            nr_strength=nr_strength,
            nr_noise_sample_sec=nr_noise_sample_sec,
            parallel_bypass=parallel_bypass,
            parallel_threshold_db=parallel_threshold_db,
            parallel_ratio=parallel_ratio,
            parallel_attack_ms=parallel_attack_ms,
            parallel_release_ms=parallel_release_ms,
            parallel_mix=parallel_mix,
            output_format=output_format,
            output_bit_depth=output_bit_depth,
            dither_mode=dither_mode,
            platform_target=platform_target,
        )
        mt = "audio/mpeg" if output_format == "mp3" else ("audio/flac" if output_format == "flac" else "audio/wav")
        return FileResponse(result["output_path"], media_type=mt, filename=f"mastered.{output_format}")
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))
    finally:
        if os.path.exists(tmp): os.remove(tmp)

# ── Master por referencia (reference-track matching) ───────────────────────────
def _read_reference_params(
    eq_bands: int, eq_max_boost_db: float, eq_max_cut_db: float, eq_q: float,
    eq_match_blend: float, eq_fit_method: str, oversample_mode: str,
    match_loudness: bool, match_dynamics: bool, match_stereo_width: bool,
    hp_cutoff: float, limiter_release_ms: float, output_format: str,
    output_bit_depth: int = 24,
    dynamics_margin_db: float = 1.0, stereo_blend: float = 0.85,
    match_transient: bool = True, match_sub_bass: bool = True, match_desser: bool = True,
    match_saturation: bool = False, ms_eq_matching: bool = True,
    adaptive_loudness_weighting: bool = True, loudness_sensitivity_amount: float = 0.65,
    premium_match_profile: str = "balanced", premium_vocal_protect: bool = True,
    premium_translation_check: bool = True, premium_alt_versions: bool = False,
    iterative_eq_passes: int = 3, match_crest: bool = True, crest_amount: float = 0.75,
    loudness_target_lufs: float = None,
    match_spectral_dynamics: bool = True, spectral_dynamics_amount: float = 0.60,
    spectral_dynamics_bins: int = 4,
    use_multiband_saturation: bool = False, mb_sat_low_drive: float = 0.05,
    mb_sat_mid_drive: float = 0.04, mb_sat_high_drive: float = 0.02,
    mb_sat_mix: float = 0.45, mb_sat_mode: str = "tape",
    use_parallel_compression: bool = False, parallel_threshold_db: float = -20.0,
    parallel_ratio: float = 4.0, parallel_attack_ms: float = 10.0,
    parallel_release_ms: float = 150.0, parallel_makeup_db: float = 6.0,
    parallel_mix: float = 0.28,
    use_two_stage_limiter: bool = True, gentle_ceiling_db: float = -2.5,
    gentle_release_ms: float = 120.0,
    max_target_lufs: float = -12.0,
) -> dict:
    return dict(
        eq_bands=eq_bands, eq_max_boost_db=eq_max_boost_db, eq_max_cut_db=eq_max_cut_db,
        eq_q=eq_q, eq_match_blend=eq_match_blend, eq_fit_method=eq_fit_method,
        oversample_mode=oversample_mode,
        match_loudness=match_loudness, match_dynamics=match_dynamics,
        match_stereo_width=match_stereo_width, hp_cutoff=hp_cutoff,
        limiter_release_ms=limiter_release_ms, output_format=output_format,
        output_bit_depth=output_bit_depth,
        dynamics_margin_db=dynamics_margin_db, stereo_blend=stereo_blend,
        match_transient=match_transient, match_sub_bass=match_sub_bass, match_desser=match_desser,
        match_saturation=match_saturation, ms_eq_matching=ms_eq_matching,
        adaptive_loudness_weighting=adaptive_loudness_weighting,
        loudness_sensitivity_amount=loudness_sensitivity_amount,
        premium_match_profile=premium_match_profile,
        premium_vocal_protect=premium_vocal_protect,
        premium_translation_check=premium_translation_check,
        premium_alt_versions=premium_alt_versions,
        iterative_eq_passes=iterative_eq_passes,
        match_crest=match_crest,
        crest_amount=crest_amount,
        loudness_target_lufs=loudness_target_lufs,
        match_spectral_dynamics=match_spectral_dynamics,
        spectral_dynamics_amount=spectral_dynamics_amount,
        spectral_dynamics_bins=spectral_dynamics_bins,
        use_multiband_saturation=use_multiband_saturation,
        mb_sat_low_drive=mb_sat_low_drive,
        mb_sat_mid_drive=mb_sat_mid_drive,
        mb_sat_high_drive=mb_sat_high_drive,
        mb_sat_mix=mb_sat_mix,
        mb_sat_mode=mb_sat_mode,
        use_parallel_compression=use_parallel_compression,
        parallel_threshold_db=parallel_threshold_db,
        parallel_ratio=parallel_ratio,
        parallel_attack_ms=parallel_attack_ms,
        parallel_release_ms=parallel_release_ms,
        parallel_makeup_db=parallel_makeup_db,
        parallel_mix=parallel_mix,
        use_two_stage_limiter=use_two_stage_limiter,
        gentle_ceiling_db=gentle_ceiling_db,
        gentle_release_ms=gentle_release_ms,
        max_target_lufs=max_target_lufs,
    )

@app.post("/master/reference", tags=["Mastering"])
async def master_with_reference(
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(None, description="Track propio a masterizar (o mandá library_id)"),
    reference_file: Optional[UploadFile] = File(None, description="Track de referencia (o mandá reference_library_id)"),
    library_id: Optional[str] = Form(None, description="Alternativa a 'file': id de un archivo ya guardado en /library"),
    reference_library_id: Optional[str] = Form(None, description="Alternativa a 'reference_file': id de una referencia ya guardada en /library"),
    eq_bands: int              = Query(28,   ge=4,    le=40),
    eq_max_boost_db: float     = Query(6.0,  ge=0.0,  le=18.0),
    eq_max_cut_db: float       = Query(-9.0, ge=-24.0, le=0.0),
    eq_q: float                = Query(1.3,  ge=0.3,  le=6.0),
    eq_match_blend: float      = Query(0.75, ge=0.0,  le=1.0,
                                       description="Cantidad de EQ match a aplicar (0=no toca, 1=matching completo)"),
    eq_fit_method: str         = Query("heuristic", pattern="^(heuristic|ddsp)$",
                                       description="Cómo se calcula la curva de EQ de matching: 'heuristic' (resta+suavizado+clip) o 'ddsp' (descenso de gradiente multi-resolución sobre la curva de ganancias)."),
    oversample_mode: str       = Query("quality", pattern="^(off|draft|fast|quality|ultra)$"),
    match_loudness: bool       = Query(True),
    match_dynamics: bool       = Query(True),
    match_stereo_width: bool   = Query(True),
    hp_cutoff: float           = Query(30.0, ge=20.0, le=200.0),
    limiter_release_ms: float  = Query(60.0, ge=1.0,  le=500.0),
    output_format: str         = Query("wav", pattern="^(wav|flac|mp3)$"),
    output_bit_depth: int      = Query(24, description="Bit depth de salida (WAV/FLAC): 16, 24 o 32 (float). Se aplica dither TPDF si baja de 32."),
    dynamics_margin_db: float  = Query(1.0,  ge=0.0,  le=6.0,
                                       description="Margen (dB) de crest factor por banda antes de comprimir para acercar la dinámica a la referencia"),
    stereo_blend: float        = Query(0.85, ge=0.0,  le=1.0,
                                       description="Qué tan agresivamente se acerca el ancho estéreo por banda al de la referencia (0=no toca, 1=matching total)"),
    match_transient: bool      = Query(True, description="Iguala punch/densidad de transientes contra la referencia (transient shaper calibrado)"),
    match_sub_bass: bool       = Query(True, description="Ajusta el perfil de sub-graves (20-250 Hz) contra la referencia"),
    match_desser: bool         = Query(True, description="De-esser calibrado: corrige sibilancia solo si el track supera a la referencia"),
    match_saturation: bool     = Query(False, description="Iguala carácter armónico/saturación — opcional, decisión artística del usuario"),
    ms_eq_matching: bool       = Query(True, description="EQ de matching independiente para Mid y Side (recomendado para stereo)"),
    adaptive_loudness_weighting: bool = Query(True, description="Usa LUFS perceptual adaptativo: pondera la zona 3-6 kHz, donde el oído humano es más sensible, al igualar loudness contra la referencia"),
    loudness_sensitivity_amount: float = Query(0.65, ge=0.0, le=1.0, description="Intensidad de la ponderación auditiva 3-6 kHz para el match de loudness"),
    premium_match_profile: str = Query("balanced", pattern="^(balanced|club|audiophile|broadcast)$", description="Perfil premium que documenta la intención del match y habilita automatizaciones futuras"),
    premium_vocal_protect: bool = Query(True, description="Protege voz líder y centro mono en flujos premium"),
    premium_translation_check: bool = Query(True, description="Registra chequeos de traducción mono/auriculares/parlantes chicos"),
    premium_alt_versions: bool = Query(False, description="Prepara metadata para versiones clean/instrumental/TV"),
    iterative_eq_passes: int   = Query(3, ge=1, le=4, description="Pasadas de EQ matching iterativo con blend decreciente (1=comportamiento anterior, 3=recomendado, 4=máximo)"),
    match_crest: bool          = Query(True, description="Iguala el crest factor (peak/RMS) de la referencia para matchear la dinámica percibida, banda por banda"),
    crest_amount: float        = Query(0.75, ge=0.0, le=1.0, description="Intensidad del crest matching (0=sin cambio, 1=match completo, 0.75=recomendado)"),
    loudness_target_lufs: float = Query(None, ge=-30.0, le=-4.0,
                                        description="Si se especifica (ej. -14.0), fija el LUFS de salida a este valor SIN IMPORTAR el loudness de la referencia. Si se omite, matchea el LUFS de la referencia (comportamiento anterior)."),
    match_spectral_dynamics: bool  = Query(False, description="Iguala el balance espectral por rango dinamico"),
    spectral_dynamics_amount: float = Query(0.60, ge=0.0, le=1.0, description="Intensidad del matching espectral dinamico"),
    spectral_dynamics_bins: int    = Query(4, ge=2, le=4, description="Cantidad de rangos dinamicos"),
    use_multiband_saturation: bool = Query(False, description="Saturacion armonica multibanda (bajos/medios/agudos independiente)"),
    mb_sat_low_drive: float        = Query(0.07, ge=0.0, le=0.5, description="Drive saturacion graves"),
    mb_sat_mid_drive: float        = Query(0.04, ge=0.0, le=0.5, description="Drive saturacion medios"),
    mb_sat_high_drive: float       = Query(0.02, ge=0.0, le=0.3, description="Drive saturacion agudos"),
    mb_sat_mix: float              = Query(0.45, ge=0.0, le=1.0, description="Wet/dry saturacion multibanda"),
    mb_sat_mode: str               = Query("tape", description="Modo saturacion: tape, tube, analog"),
    use_parallel_compression: bool = Query(False, description="Compresion paralela New York (agrega densidad sin tocar transientes)"),
    parallel_threshold_db: float   = Query(-20.0, ge=-40.0, le=-6.0, description="Threshold compresion paralela (dB)"),
    parallel_ratio: float          = Query(4.0, ge=1.5, le=10.0, description="Ratio compresion paralela"),
    parallel_attack_ms: float      = Query(10.0, ge=1.0, le=100.0, description="Attack compresion paralela (ms)"),
    parallel_release_ms: float     = Query(150.0, ge=20.0, le=500.0, description="Release compresion paralela (ms)"),
    parallel_makeup_db: float      = Query(6.0, ge=0.0, le=18.0, description="Makeup gain compresion paralela (dB)"),
    parallel_mix: float            = Query(0.28, ge=0.0, le=1.0, description="Mix wet/dry compresion paralela (0=bypass, 0.25-0.40=tipico NY)"),
    use_two_stage_limiter: bool    = Query(True, description="Limitador en dos etapas: gentle + brickwall final"),
    gentle_ceiling_db: float       = Query(-2.5, ge=-12.0, le=-0.5, description="Techo del limitador gentle (etapa 1, dBTP)"),
    gentle_release_ms: float       = Query(120.0, ge=20.0, le=500.0, description="Release limitador gentle (ms)"),
    max_target_lufs: float         = Query(-12.0, ge=-18.0, le=-6.0,
                                           description="Techo de loudness del match, en LUFS. El match SIEMPRE intenta llegar al LUFS de la referencia, pero nunca supera este valor, sin importar qué tan hot venga la referencia. Rango admisible: -18 (conservador) a -6 (muy hot)."),
    current_user: dict = Depends(get_current_user),
):
    data, filename = await resolve_input_source(file, library_id)
    # Si el ID viene de la biblioteca de referencias permanentes, leerlo directo
    _ref_lib_path = ref_lib.get_path(reference_library_id) if reference_library_id else None
    if _ref_lib_path and not (reference_file and reference_file.filename):
        ref_data = open(_ref_lib_path, "rb").read()
        reference_filename = os.path.basename(_ref_lib_path)
    else:
        ref_data, reference_filename = await resolve_input_source(reference_file, reference_library_id)

    job_id = uuid.uuid4().hex
    input_path     = os.path.join(UPLOAD_DIR, f"{job_id}_{filename}")
    reference_path = os.path.join(UPLOAD_DIR, f"{job_id}_ref_{reference_filename}")
    with open(input_path, "wb") as f: f.write(data)
    with open(reference_path, "wb") as f: f.write(ref_data)

    params = _read_reference_params(eq_bands, eq_max_boost_db, eq_max_cut_db, eq_q,
                                    eq_match_blend, eq_fit_method, oversample_mode,
                                    match_loudness, match_dynamics, match_stereo_width,
                                    hp_cutoff, limiter_release_ms, output_format,
                                    output_bit_depth, dynamics_margin_db, stereo_blend,
                                    match_transient, match_sub_bass, match_desser,
                                    match_saturation, ms_eq_matching,
                                    adaptive_loudness_weighting, loudness_sensitivity_amount,
                                    premium_match_profile, premium_vocal_protect,
                                    premium_translation_check, premium_alt_versions,
                                    iterative_eq_passes, match_crest, crest_amount,
                                    loudness_target_lufs,
                                    match_spectral_dynamics, spectral_dynamics_amount,
                                    spectral_dynamics_bins,
                                    use_multiband_saturation, mb_sat_low_drive,
                                    mb_sat_mid_drive, mb_sat_high_drive,
                                    mb_sat_mix, mb_sat_mode,
                                    use_parallel_compression, parallel_threshold_db,
                                    parallel_ratio, parallel_attack_ms,
                                    parallel_release_ms, parallel_makeup_db,
                                    parallel_mix,
                                    use_two_stage_limiter, gentle_ceiling_db,
                                    gentle_release_ms,
                                    max_target_lufs)
    duration = _get_input_duration(input_path)
    job_params = dict(params, reference_filename=reference_filename)
    if duration is not None:
        job_params["_input_duration_sec"] = duration
    jobs.create_job(job_id, {"status": "queued", "filename": filename, "created_at": time.time(), "params": job_params, "progress": 0, "stage": "En cola"})
    background_tasks.add_task(run_reference_job, job_id, input_path, reference_path, params)
    return {"job_id": job_id, "status": "queued", "poll_url": f"/job/{job_id}"}

@app.post("/master/reference/sync", tags=["Mastering"])
async def master_with_reference_sync(
    file: Optional[UploadFile] = File(None, description="Track propio a masterizar (o mandá library_id)"),
    reference_file: Optional[UploadFile] = File(None, description="Track de referencia (o mandá reference_library_id)"),
    library_id: Optional[str] = Form(None),
    reference_library_id: Optional[str] = Form(None),
    eq_bands: int              = Query(28,   ge=4,    le=40),
    eq_max_boost_db: float     = Query(6.0,  ge=0.0,  le=18.0),
    eq_max_cut_db: float       = Query(-9.0, ge=-24.0, le=0.0),
    eq_q: float                = Query(1.3,  ge=0.3,  le=6.0),
    eq_match_blend: float      = Query(0.75, ge=0.0,  le=1.0,
                                       description="Cantidad de EQ match a aplicar (0=no toca, 1=matching completo)"),
    eq_fit_method: str         = Query("heuristic", pattern="^(heuristic|ddsp)$",
                                       description="Cómo se calcula la curva de EQ de matching: 'heuristic' (resta+suavizado+clip) o 'ddsp' (descenso de gradiente multi-resolución sobre la curva de ganancias)."),
    oversample_mode: str       = Query("quality", pattern="^(off|draft|fast|quality|ultra)$"),
    match_loudness: bool       = Query(True),
    match_dynamics: bool       = Query(True),
    match_stereo_width: bool   = Query(True),
    hp_cutoff: float           = Query(30.0, ge=20.0, le=200.0),
    limiter_release_ms: float  = Query(60.0, ge=1.0,  le=500.0),
    output_format: str         = Query("wav", pattern="^(wav|flac|mp3)$"),
    output_bit_depth: int      = Query(24, description="Bit depth de salida (WAV/FLAC): 16, 24 o 32 (float). Se aplica dither TPDF si baja de 32."),
    preview_seconds: float     = Query(None, ge=1.0, le=60.0),
    dynamics_margin_db: float  = Query(1.0,  ge=0.0,  le=6.0),
    stereo_blend: float        = Query(0.85, ge=0.0,  le=1.0),
    match_transient: bool      = Query(True),
    match_sub_bass: bool       = Query(True),
    match_desser: bool         = Query(True),
    match_saturation: bool     = Query(False),
    adaptive_loudness_weighting: bool = Query(True),
    loudness_sensitivity_amount: float = Query(0.65, ge=0.0, le=1.0),
    premium_match_profile: str = Query("balanced", pattern="^(balanced|club|audiophile|broadcast)$"),
    premium_vocal_protect: bool = Query(True),
    premium_translation_check: bool = Query(True),
    premium_alt_versions: bool = Query(False),
    loudness_target_lufs: float = Query(None, ge=-30.0, le=-4.0,
                                        description="Si se especifica (ej. -14.0), fija el LUFS de salida a este valor SIN IMPORTAR el loudness de la referencia."),
):
    data, filename = await resolve_input_source(file, library_id)
    # Si el ID viene de la biblioteca de referencias permanentes, leerlo directo
    _ref_lib_path = ref_lib.get_path(reference_library_id) if reference_library_id else None
    if _ref_lib_path and not (reference_file and reference_file.filename):
        ref_data = open(_ref_lib_path, "rb").read()
        reference_filename = os.path.basename(_ref_lib_path)
    else:
        ref_data, reference_filename = await resolve_input_source(reference_file, reference_library_id)

    tmp     = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}_{filename}")
    tmp_ref = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}_ref_{reference_filename}")
    try:
        cleanup_old()
        with open(tmp, "wb") as f: f.write(data)
        with open(tmp_ref, "wb") as f: f.write(ref_data)
        result = await run_in_threadpool(
            process_audio_with_reference, tmp, tmp_ref,
            eq_bands=eq_bands, eq_max_boost_db=eq_max_boost_db, eq_max_cut_db=eq_max_cut_db,
            eq_q=eq_q, eq_match_blend=eq_match_blend, eq_fit_method=eq_fit_method,
            oversample_mode=oversample_mode,
            match_loudness=match_loudness, match_dynamics=match_dynamics,
            match_stereo_width=match_stereo_width, hp_cutoff=hp_cutoff,
            limiter_release_ms=limiter_release_ms, output_format=output_format,
            output_bit_depth=output_bit_depth,
            preview_seconds=preview_seconds,
            dynamics_margin_db=dynamics_margin_db, stereo_blend=stereo_blend,
            match_transient=match_transient, match_sub_bass=match_sub_bass, match_desser=match_desser,
            match_saturation=match_saturation,
            adaptive_loudness_weighting=adaptive_loudness_weighting,
            loudness_sensitivity_amount=loudness_sensitivity_amount,
            premium_match_profile=premium_match_profile,
            premium_vocal_protect=premium_vocal_protect,
            premium_translation_check=premium_translation_check,
            premium_alt_versions=premium_alt_versions,
            loudness_target_lufs=loudness_target_lufs,
        )
        mt = "audio/mpeg" if output_format == "mp3" else ("audio/flac" if output_format == "flac" else "audio/wav")
        headers = {"X-Reference-Match": str(result["reference_match"]["after"]["match_percent"])}
        return FileResponse(result["output_path"], media_type=mt, filename=f"mastered_refmatch.{output_format}", headers=headers)
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))
    finally:
        if os.path.exists(tmp): os.remove(tmp)
        if os.path.exists(tmp_ref): os.remove(tmp_ref)

@app.post("/master/normalize", tags=["Mastering"])
async def master_normalize(
    background_tasks: BackgroundTasks,
    file: Optional[UploadFile] = File(None, description="Track a normalizar (o mandá library_id)"),
    library_id: Optional[str] = Form(None, description="Alternativa a 'file': id de un archivo ya guardado en /library"),
    target_lufs: float = Query(-14.0, ge=-23.0, le=-6.0,
                               description="LUFS de destino. Rango admisible: -23 (broadcast/EBU R128) a -6 (muy hot). "
                                           "-14 es el default típico de streaming (Spotify/YouTube)."),
    output_format: str = Query("wav", pattern="^(wav|flac|mp3)$"),
    output_bit_depth: int = Query(24, description="Bit depth de salida (WAV/FLAC): 16, 24 o 32 (float)."),
    true_peak_safety_db: float = Query(-1.0, ge=-3.0, le=-0.1,
                                       description="Techo de pico de seguridad (dBTP) — nunca se cruza, ni siquiera si eso implica no llegar al target_lufs pedido."),
    current_user: dict = Depends(get_current_user),
):
    """Normalización PURA por LUFS. Sin EQ, sin dinámica, sin matching contra
    referencia, sin limitador — una sola ganancia. Pensado para el caso
    'solo quiero que suene al volumen correcto, nada más'."""
    data, filename = await resolve_input_source(file, library_id)
    job_id = uuid.uuid4().hex
    input_path = os.path.join(UPLOAD_DIR, f"{job_id}_{filename}")
    with open(input_path, "wb") as f: f.write(data)

    params = dict(target_lufs=target_lufs, output_format=output_format,
                 output_bit_depth=output_bit_depth, true_peak_safety_db=true_peak_safety_db)
    duration = _get_input_duration(input_path)
    job_params = dict(params)
    if duration is not None:
        job_params["_input_duration_sec"] = duration
    jobs.create_job(job_id, {"status": "queued", "filename": filename, "created_at": time.time(), "params": job_params, "progress": 0, "stage": "En cola"})
    background_tasks.add_task(run_normalize_job, job_id, input_path, params)
    return {"job_id": job_id, "status": "queued", "poll_url": f"/job/{job_id}"}

@app.post("/master/normalize/sync", tags=["Mastering"])
async def master_normalize_sync(
    file: Optional[UploadFile] = File(None, description="Track a normalizar (o mandá library_id)"),
    library_id: Optional[str] = Form(None),
    target_lufs: float = Query(-14.0, ge=-23.0, le=-6.0),
    output_format: str = Query("wav", pattern="^(wav|flac|mp3)$"),
    output_bit_depth: int = Query(24),
    true_peak_safety_db: float = Query(-1.0, ge=-3.0, le=-0.1),
):
    data, filename = await resolve_input_source(file, library_id)
    tmp = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}_{filename}")
    try:
        cleanup_old()
        with open(tmp, "wb") as f: f.write(data)
        result = await run_in_threadpool(
            normalize_by_lufs, tmp,
            target_lufs=target_lufs, output_format=output_format,
            output_bit_depth=output_bit_depth, true_peak_safety_db=true_peak_safety_db,
        )
        mt = "audio/mpeg" if output_format == "mp3" else ("audio/flac" if output_format == "flac" else "audio/wav")
        headers = {"X-Output-LUFS": str(result["normalization"]["output_lufs"])}
        return FileResponse(result["output_path"], media_type=mt, filename=f"normalized.{output_format}", headers=headers)
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))
    finally:
        if os.path.exists(tmp): os.remove(tmp)

@app.post("/pitch-correct", tags=["Audioprocesamiento"])
async def pitch_correct(
    file: Optional[UploadFile] = File(None),
    library_id: Optional[str] = Form(None),
    mode: str = Form("MEDIUM", pattern="^(OFF|LIGHT|MEDIUM|STRONG)$"),
    scale: Optional[str] = Form(None),
    glide_time_ms: float = Form(50.0, ge=0, le=200),
    output_format: str = Form("wav", pattern="^(wav|flac|mp3)$"),
    current_user: dict = Depends(get_current_user),
):
    """Aplica corrección automática de pitch a vocales/instrumentos.
    
    Modos:
      - OFF: desactivado
      - LIGHT: corrección sutil (±20 cents)
      - MEDIUM: corrección estándar (±50 cents) [default]
      - STRONG: corrección agresiva (±100 cents, corrige todo)
    
    Escalas: C_major, A_minor, G_major, etc. (None = auto-detect)
    """
    logger.info(f"🎵 {current_user['email']} pitch-correct: mode={mode}, scale={scale}")
    
    data, filename = await resolve_input_source(file, library_id)
    tmp = os.path.join(UPLOAD_DIR, f"pitch_{uuid.uuid4().hex}")
    output_path = os.path.join(PROCESSED_DIR, f"corrected_{uuid.uuid4().hex}.{output_format}")
    
    try:
        with open(tmp, "wb") as f:
            f.write(data)
        
        # Cargar audio
        audio, sr = await run_in_threadpool(librosa.load, tmp, sr=None, mono=True)
        
        # Aplicar pitch correction
        processor = PitchCorrectionProcessor(sr)
        corrected = processor.process(audio, mode=mode, scale=scale, glide_time_ms=glide_time_ms)
        
        detected_key, detected_confidence = processor.get_detected_key()
        
        # Guardar resultado. soundfile no escribe MP3; para MP3 usamos pydub/ffmpeg.
        if output_format == "mp3":
            from pydub import AudioSegment

            pcm = np.clip(corrected, -1.0, 1.0)
            pcm16 = (pcm * 32767.0).astype(np.int16)
            pcm_wav = tmp + "_pcm.wav"
            await run_in_threadpool(
                sf.write,
                pcm_wav,
                pcm16,
                sr,
                subtype="PCM_16",
                format="WAV",
            )
            try:
                def _export_mp3():
                    seg = AudioSegment.from_wav(pcm_wav)
                    seg.export(output_path, format="mp3", bitrate="320k")

                await run_in_threadpool(_export_mp3)
            finally:
                if os.path.exists(pcm_wav):
                    os.remove(pcm_wav)
        else:
            await run_in_threadpool(sf.write, output_path, corrected, sr)
        
        logger.info(f"✓ Pitch correction completado: detected_key={detected_key}, confidence={detected_confidence:.2f}")
        
        mt = "audio/mpeg" if output_format == "mp3" else ("audio/flac" if output_format == "flac" else "audio/wav")
        return FileResponse(
            output_path,
            media_type=mt,
            filename=f"corrected.{output_format}",
            headers={
                "X-Mode": mode,
                "X-Detected-Key": detected_key,
                "X-Confidence": str(detected_confidence),
            }
        )
    except HTTPException: raise
    except Exception as e:
        logger.error(f"❌ Pitch correction error: {e}")
        raise HTTPException(500, str(e))
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)

# ── Jobs ──────────────────────────────────────────────────────────────────────

# ── Mix multistem ─────────────────────────────────────────────────────────────

def run_mix_job(job_id: str, stem_paths: dict, sr: int,
                stem_params: dict, mix_params_dict: dict, cleanup_paths: Optional[set] = None):
    """Job de mezcla y mastering multistem."""
    jobs.update_job(job_id, status="processing", progress=0, stage="Iniciando mezcla")
    try:
        import librosa as _lr, soundfile as _sf

        # Cargar stems
        stems = {}
        for name, path in stem_paths.items():
            audio, file_sr = _lr.load(path, sr=None, mono=False)
            if audio.ndim == 1:
                audio = audio[np.newaxis, :]
            # Resamplear si es necesario
            if file_sr != sr:
                import librosa
                audio = librosa.resample(audio, orig_sr=file_sr, target_sr=sr)
            stems[name] = audio.astype(np.float32)

        # Construir StemParams
        s_params = {}
        for name, p in stem_params.items():
            sp = StemParams(name=name)
            for k, v in p.items():
                if hasattr(sp, k):
                    setattr(sp, k, v)
            s_params[name] = sp

        # Construir MixParams
        mp = MixParams()
        for k, v in mix_params_dict.items():
            if hasattr(mp, k):
                setattr(mp, k, v)

        result = mix_and_master(
            stems=stems,
            sr=sr,
            stem_params=s_params,
            mix_params=mp,
            progress_cb=_make_progress_cb(job_id),
        )

        jobs.update_job(job_id, status="done", result=result,
                       progress=100, stage="Completado")
    except Exception as e:
        logger.error(f"run_mix_job error: {e}", exc_info=True)
        jobs.update_job(job_id, status="error", error=str(e))
    finally:
        # Limpiar solo stems temporales de sesión; nunca borrar archivos persistentes de la librería.
        for path in (set(stem_paths.values()) if cleanup_paths is None else cleanup_paths):
            try:
                if os.path.exists(path):
                    os.remove(path)
            except Exception:
                pass


@app.post("/mix", tags=["Mixer"])
async def mix_stems_endpoint(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(..., description="Stems de audio (uno por instrumento)"),
    stem_params: str = Form("{}", description="JSON: {nombre_stem: {gain_db, pan, comp_enabled, ...}}"),
    mix_params: str = Form("{}", description="JSON: {master_gain_db, target_lufs, chain_params, ...}"),
    sr: int = Form(44100, description="Sample rate de referencia para el mix"),
    current_user: dict = Depends(get_current_user),
):
    """Recibe N stems, los procesa individualmente y los mezcla + masteriza.

    Cada archivo se asocia al stem con su nombre de archivo (sin extensión).
    stem_params es un dict JSON {nombre: StemParams} con los parámetros por canal.
    mix_params es un dict JSON con parámetros globales del mix.
    """
    import json as _json

    if not files:
        raise HTTPException(400, "Se requiere al menos un stem.")

    try:
        s_params_dict = _json.loads(stem_params)
    except Exception:
        raise HTTPException(400, "stem_params no es JSON válido.")
    try:
        m_params_dict = _json.loads(mix_params)
    except Exception:
        raise HTTPException(400, "mix_params no es JSON válido.")

    job_id = uuid.uuid4().hex
    stem_paths = {}

    for file in files:
        validate_audio_file(file.filename)
        data = await read_and_validate(file)
        stem_name = os.path.splitext(file.filename)[0]
        path = os.path.join(UPLOAD_DIR, f"{job_id}_stem_{stem_name}{os.path.splitext(file.filename)[1]}")
        with open(path, "wb") as fh:
            fh.write(data)
        stem_paths[stem_name] = path

    jobs.create_job(job_id, {
        "status": "queued",
        "type": "mix",
        "stem_names": list(stem_paths.keys()),
        "created_at": time.time(),
        "progress": 0,
        "stage": "En cola",
    })

    background_tasks.add_task(
        run_mix_job, job_id, stem_paths, sr, s_params_dict, m_params_dict
    )

    return {"job_id": job_id, "status": "queued",
            "stem_names": list(stem_paths.keys()),
            "poll_url": f"/job/{job_id}"}



def _mix_session_stem_path(session_id: str, name: str) -> Optional[str]:
    """Devuelve el path temporal de un stem subido a una sesión del mixer."""
    import glob as _glob
    # BUGFIX: `name` viene del nombre de archivo que subió el usuario (ej.
    # "Vocals (Lead) [Take 3]") y se interpolaba directo en el patrón de
    # glob.glob() sin escapar. Caracteres de glob como [ ] * ? en el nombre
    # se interpretaban como wildcards/clases de caracteres en vez de texto
    # literal, así que el stem no se encontraba aunque el archivo existiera
    # en disco con ese nombre exacto. glob.escape() neutraliza el nombre y
    # deja `.* ` como el único wildcard real (la extensión).
    matches = _glob.glob(os.path.join(UPLOAD_DIR, _glob.escape(f"mix_{session_id}_{name}") + ".*"))
    return matches[0] if matches else None


def _mix_library_stem_path(file_id: Optional[str]) -> Optional[str]:
    """Devuelve el path persistente de un stem guardado en la librería del mixer."""
    if not file_id:
        return None
    return library.get_path(STEM_LIBRARY_DIR, file_id)


def _resolve_mix_stem_path(session_id: str, name: str, library_ids: Optional[dict] = None) -> Optional[str]:
    """Resuelve un stem del mixer desde la librería persistente o desde la sesión temporal."""
    library_path = _mix_library_stem_path((library_ids or {}).get(name))
    if library_path:
        return library_path
    return _mix_session_stem_path(session_id, name)

@app.post("/mix/upload-stem", tags=["Mixer"])
async def mix_upload_stem(
    file: UploadFile = File(...),
    session_id: str = Form(..., description="ID de sesión del mixer para agrupar stems"),
    stem_name: str = Form("", description="Nombre del stem (opcional, usa el nombre del archivo si se omite)"),
    save_to_library: bool = Form(False, description="Guarda una copia reutilizable en la librería de stems del mixer"),
    current_user: dict = Depends(get_current_user),
):
    """Sube un stem individual para una sesión de mixer.
    El frontend puede subir stems de a uno y luego llamar a /mix/submit con el session_id.
    """
    validate_audio_file(file.filename)
    data = await read_and_validate(file)
    name = stem_name.strip() or os.path.splitext(file.filename)[0]
    path = os.path.join(UPLOAD_DIR, f"mix_{session_id}_{name}{os.path.splitext(file.filename)[1]}")
    with open(path, "wb") as fh:
        fh.write(data)

    # Analizar duración para el frontend
    import librosa as _lr
    try:
        duration = _lr.get_duration(path=path)
    except Exception:
        duration = None

    library_meta = None
    if save_to_library:
        library_meta = library.add_file(STEM_LIBRARY_DIR, file.filename, data)

    return {
        "session_id": session_id,
        "stem_name": name,
        "filename": file.filename,
        "path": path,
        "duration_sec": round(duration, 2) if duration else None,
        "library_item": library_meta,
    }



@app.get("/mix/stem-library", tags=["Mixer"])
def mix_stem_library_list():
    """Lista stems guardados para reutilizar en futuras sesiones del mixer."""
    return {"files": library.list_files(STEM_LIBRARY_DIR)}


@app.post("/mix/stem-library/upload", tags=["Mixer"])
async def mix_stem_library_upload(file: UploadFile = File(...)):
    """Guarda un stem directamente en la librería reutilizable del mixer."""
    validate_audio_file(file.filename)
    data = await read_and_validate(file)
    return library.add_file(STEM_LIBRARY_DIR, file.filename, data)


@app.get("/mix/stem-library/{file_id}/download", tags=["Mixer"])
def mix_stem_library_download(file_id: str):
    path = library.get_path(STEM_LIBRARY_DIR, file_id)
    if path is None:
        raise HTTPException(404, "Stem no encontrado en la librería del mixer.")
    meta = library.get_meta(STEM_LIBRARY_DIR, file_id)
    filename = meta["original_filename"] if meta else os.path.basename(path)
    return FileResponse(path, media_type="application/octet-stream", filename=filename)


@app.delete("/mix/stem-library/{file_id}", tags=["Mixer"])
def mix_stem_library_delete(file_id: str):
    ok = library.delete_file(STEM_LIBRARY_DIR, file_id)
    if not ok:
        raise HTTPException(404, "Stem no encontrado en la librería del mixer.")
    return {"deleted": file_id}

@app.post("/mix/ai-suggest", tags=["Mixer"])
async def mix_ai_suggest(
    session_id: str = Form(...),
    stem_names: str = Form(...),
    current_user: dict = Depends(get_current_user),
):
    """Analiza los stems ya subidos y devuelve sugerencias de parámetros de mezcla
    generadas por IA. No procesa audio — solo sugiere. El usuario decide si aplica."""
    import json as _json
    names = _json.loads(stem_names)
    if not names:
        raise HTTPException(status_code=400, detail="No hay stems para analizar")

    stems_analysis = {}
    import glob as _glob
    import soundfile as _sf
    import librosa as _lr

    for name in names:
        # Buscar el archivo del stem — el upload lo guarda como mix_{session_id}_{name}.{ext}
        # BUGFIX: mismo problema que _mix_session_stem_path — escapar el nombre
        # para que corchetes/paréntesis/asteriscos en el nombre del stem no se
        # interpreten como wildcards de glob.
        pattern = os.path.join(UPLOAD_DIR, _glob.escape(f"mix_{session_id}_{name}") + ".*")
        matches = _glob.glob(pattern)
        if not matches:
            raise HTTPException(status_code=404, detail=f"Stem '{name}' no encontrado. Subilo primero.")
        stem_path = matches[0]

        try:
            audio, sr = _lr.load(stem_path, sr=None, mono=False)
            if audio.ndim == 1:
                audio = audio[np.newaxis, :]
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error cargando stem '{name}': {e}")

        analysis = analyze_audio(audio, sr)

        # Detectar stem_type del nombre
        n_low = name.lower()
        if any(x in n_low for x in ["kick", "bd", "bombo"]):         stem_type = "kick"
        elif any(x in n_low for x in ["snare", "caja", "rim"]):      stem_type = "snare"
        elif any(x in n_low for x in ["bass", "bajo", "808"]):       stem_type = "bass"
        elif any(x in n_low for x in ["voc", "voice", "vocal"]):     stem_type = "vocals"
        elif any(x in n_low for x in ["guitar", "guit"]):            stem_type = "guitar"
        elif any(x in n_low for x in ["synth", "pad", "keys"]):      stem_type = "synth"
        elif any(x in n_low for x in ["drum", "perc", "hat"]):       stem_type = "drums"
        elif any(x in n_low for x in ["fx", "effect", "atm"]):       stem_type = "fx"
        else:                                                          stem_type = "other"

        analysis["stem_type"] = stem_type
        stems_analysis[name] = analysis

    suggestions = ai_assistant.decide_mix(stems_analysis)
    return {"suggestions": suggestions, "stems_analyzed": list(stems_analysis.keys())}


@app.post("/mix/submit", tags=["Mixer"])
async def mix_submit(
    background_tasks: BackgroundTasks,
    session_id: str = Form(...),
    current_user: dict = Depends(get_current_user),
    stem_names: str = Form(..., description="JSON list de nombres de stems subidos"),
    stem_params: str = Form("{}", description="JSON: {nombre: StemParams}"),
    mix_params: str = Form("{}", description="JSON: MixParams"),
    stem_library_ids: str = Form("{}", description="JSON opcional: {nombre: library_id} para stems reutilizables"),
    sr: int = Form(44100),
):
    """Inicia el job de mezcla con los stems ya subidos via /mix/upload-stem."""
    import json as _json

    try:
        names = _json.loads(stem_names)
        s_params_dict = _json.loads(stem_params)
        m_params_dict = _json.loads(mix_params)
        library_ids = _json.loads(stem_library_ids or "{}")
    except Exception as e:
        raise HTTPException(400, f"JSON inválido: {e}")

    # Reconstruir paths desde librería persistente o desde uploads temporales de sesión.
    stem_paths = {}
    cleanup_paths = set()
    for name in names:
        library_path = _mix_library_stem_path((library_ids or {}).get(name))
        session_path = _mix_session_stem_path(session_id, name)
        path = library_path or session_path
        if not path:
            raise HTTPException(404, f"Stem '{name}' no encontrado para session_id '{session_id}' ni en librería.")
        stem_paths[name] = path
        if path == session_path:
            cleanup_paths.add(path)

    if not stem_paths:
        raise HTTPException(400, "No se encontraron stems para esta sesión.")

    job_id = uuid.uuid4().hex
    jobs.create_job(job_id, {
        "status": "queued",
        "type": "mix",
        "session_id": session_id,
        "stem_names": list(stem_paths.keys()),
        "created_at": time.time(),
        "progress": 0,
        "stage": "En cola",
    })

    background_tasks.add_task(
        run_mix_job, job_id, stem_paths, sr, s_params_dict, m_params_dict, cleanup_paths
    )

    return {"job_id": job_id, "status": "queued",
            "stem_names": list(stem_paths.keys()),
            "poll_url": f"/job/{job_id}"}

@app.websocket("/ws/mix-stream")
async def ws_mix_stream(websocket: WebSocket, token: str = Query(None)):
    # Auth via query param (WS no soporta headers custom).
    # BUGFIX: antes esto solo validaba SI había token (`if token:`) — si el
    # frontend no lo mandaba, la conexión se aceptaba igual sin loguearse,
    # inconsistente con /mix/upload-stem, /mix/ai-suggest y /mix/submit, que
    # sí exigen sesión. Ahora el token es obligatorio siempre.
    try:
        from auth import _verify_jwt, _get_user_by_id
        payload = _verify_jwt(token)
        user = _get_user_by_id(payload["sub"])
        if not user or user.get("status") != "approved":
            await websocket.close(code=4001)
            return
    except Exception:
        await websocket.close(code=4001)
        return
    """Preview en vivo del mixdown multistem, streameado como PCM16.

    Reusa el mismo protocolo de eventos que /ws/master-stream (chunk/done/error)
    para que el frontend pueda compartir la lógica de reproducción. A diferencia
    del preview de mastering, acá los stems YA están en disco (subidos antes
    via /mix/upload-stem) — el cliente solo manda session_id + params, nunca
    bytes de audio.

    Flujo: cargar (o reusar del caché) cada stem recortado a `preview_seconds`
    → process_stem individual + sidechain + suma + gain/normalize del mix bus
    → esa mezcla se pasa por master_stream_to_pcm16 igual que el preview normal
    (con el mismo bypass de stages costosos), chunkeada y streameada.
    """
    await websocket.accept()
    try:
        config_msg = await websocket.receive_json()
        session_id = config_msg.get("session_id")
        stem_names = config_msg.get("stem_names") or []
        stem_library_ids = config_msg.get("stem_library_ids") or {}
        stem_params_dict = config_msg.get("stem_params") or {}
        mix_params_dict = config_msg.get("mix_params") or {}
        chunk_seconds = float(config_msg.get("chunk_seconds", 1.0))
        preview_seconds = float(config_msg.get("preview_seconds", 12.0))
        sr = int(config_msg.get("sr", 44100))

        if not session_id or not stem_names:
            await websocket.send_json({"event": "error", "message": "Falta session_id o stem_names."})
            return

        # ── Cargar (o reusar del caché) cada stem, ya recortado al preview ────
        stems: dict = {}
        for name in stem_names:
            library_id = stem_library_ids.get(name)
            cache_key = f"mixlib_{library_id}" if library_id else f"mix_{session_id}_{name}"
            cached = audio_cache_get(cache_key)
            if cached is not None:
                audio, file_sr = cached
            else:
                path = _resolve_mix_stem_path(session_id, name, stem_library_ids)
                if not path:
                    await websocket.send_json({"event": "error", "message": f"Stem '{name}' no encontrado (¿se subió o existe en librería?)."})
                    return
                # librosa.load es CPU-bound → threadpool para no bloquear el event loop.
                audio, file_sr = await run_in_threadpool(librosa.load, path, sr=None, mono=False)
                if audio.ndim == 1:
                    audio = audio[np.newaxis, :]
                audio = _crop_preview(audio, file_sr, preview_seconds)
                audio_cache_put(cache_key, audio, file_sr)
            if file_sr != sr:
                audio = await run_in_threadpool(librosa.resample, audio, orig_sr=file_sr, target_sr=sr)
            stems[name] = audio.astype(np.float32)

        # ── Reconstruir StemParams / MixParams desde el JSON del cliente ──────
        s_params = {}
        for name in stem_names:
            sp = StemParams(name=name)
            for k, v in (stem_params_dict.get(name) or {}).items():
                if hasattr(sp, k):
                    setattr(sp, k, v)
            s_params[name] = sp

        mp = MixParams()
        for k, v in mix_params_dict.items():
            if hasattr(mp, k):
                setattr(mp, k, v)

        # ── Procesar stems + sidechain + suma (batch, sobre el crop corto) ────
        def _build_mix():
            processed = {}
            solo_active = any(p.solo for p in s_params.values())
            for name, audio in stems.items():
                p = s_params[name]
                if solo_active and not p.solo:
                    processed[name] = np.zeros_like(_ensure_stereo(audio))
                    continue
                proc, _m = process_stem(_ensure_stereo(audio), sr, p)
                processed[name] = proc
            for name, p in s_params.items():
                if p.sidechain_trigger_name and p.sidechain_trigger_name in processed:
                    ducked, _sc = apply_sidechain(
                        processed[name], processed[p.sidechain_trigger_name], sr,
                        threshold=p.sidechain_threshold, ratio=p.sidechain_ratio,
                        attack_ms=p.sidechain_attack_ms, release_ms=p.sidechain_release_ms,
                    )
                    processed[name] = ducked
            arrays = _match_length(list(processed.values()))
            mix = np.sum(arrays, axis=0).astype(np.float32)
            if abs(mp.master_gain_db) > 0.01:
                mix = mix * 10.0 ** (mp.master_gain_db / 20.0)
            if mp.normalize_before_master:
                peak = np.max(np.abs(mix))
                if peak > 0.9:
                    mix = mix * (0.9 / peak)
            return mix

        mix = await run_in_threadpool(_build_mix)

        # ── Streaming del mix bus por la cadena de mastering ──────────────────
        # Mismo protocolo de eventos y mismo bypass de stages costosos que
        # /ws/master-stream — ver ese endpoint para el detalle del porqué.
        chain_params = coerce_ws_chain_params(dict(mp.chain_params))
        for _bypass_key in ("nr_bypass", "dyneq_bypass", "reso_bypass", "tonal_balance_bypass"):
            chain_params.setdefault(_bypass_key, True)

        chunk_gen = master_stream_to_pcm16(mix, sr, chunk_seconds=chunk_seconds,
                                          pcm_format="int16", **chain_params)
        _SENTINEL = object()

        def _next_chunk():
            try:
                return next(chunk_gen)
            except StopIteration:
                return _SENTINEL

        while True:
            item = await run_in_threadpool(_next_chunk)
            if item is _SENTINEL:
                break
            pcm_bytes, metrics = item
            await websocket.send_json({"event": "chunk", "metrics": metrics, "sample_rate": sr, "channels": int(mix.shape[0])})
            await websocket.send_bytes(pcm_bytes)

        await websocket.send_json({"event": "done"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"ws_mix_stream error: {e}", exc_info=True)
        try:
            await websocket.send_json({"event": "error", "message": str(e)})
        except Exception:
            pass
