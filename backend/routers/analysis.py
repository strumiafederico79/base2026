from __future__ import annotations

import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from ..audio_service import AudioService
from ..mastering import analyze_audio, mix_advice
from ..validation_utils import MAX_FILE_SIZE, validate_audio_file


def create_analysis_router(*, upload_dir: str, read_and_validate, logger, current_user_dependency, audio_service: AudioService | None = None) -> APIRouter:
    router = APIRouter()

    @router.post("/analyze", tags=["Análisis"])
    async def analyze(file: UploadFile = File(...), current_user: dict = Depends(current_user_dependency)):
        logger.info(f"🔍 {current_user['email']} analizando: {file.filename}")
        validate_audio_file(file.filename)
        data = await read_and_validate(file)
        tmp = os.path.join(upload_dir, f"analyze_{uuid.uuid4().hex}")
        try:
            with open(tmp, "wb") as fh:
                fh.write(data)
            result = await audio_service.analyze_file(tmp) if audio_service else analyze_audio(tmp)
            logger.info(f"✓ Análisis completado: {file.filename}")
            return result
        except HTTPException:
            raise
        except Exception as exc:
            logger.error(f"❌ Error analizando {file.filename}: {exc}")
            raise HTTPException(500, str(exc)) from exc
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    @router.post("/mix-advice", tags=["Análisis"])
    async def get_mix_advice(file: UploadFile = File(...), current_user: dict = Depends(current_user_dependency)):
        validate_audio_file(file.filename)
        data = await read_and_validate(file)
        tmp = os.path.join(upload_dir, f"advice_{uuid.uuid4().hex}")
        try:
            with open(tmp, "wb") as fh:
                fh.write(data)
            analysis = await audio_service.analyze_file(tmp) if audio_service else analyze_audio(tmp)
            return {"analysis": analysis, **mix_advice(analysis)}
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(500, str(exc)) from exc
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    @router.post("/spectrum", tags=["Análisis"])
    async def spectrum(
        file: UploadFile = File(...),
        n_fft: int = Query(4096, ge=256, le=16384),
        n_bins: int = Query(64, ge=8, le=256),
        current_user: dict = Depends(current_user_dependency),
    ):
        validate_audio_file(file.filename)
        data = await read_and_validate(file)
        tmp = os.path.join(upload_dir, f"spectrum_{uuid.uuid4().hex}")
        try:
            with open(tmp, "wb") as fh:
                fh.write(data)
            return await audio_service.spectrum_file(tmp, n_fft=n_fft, n_bins=n_bins) if audio_service else {"error": "audio_service required"}
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(500, str(exc)) from exc
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    return router
