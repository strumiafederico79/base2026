from __future__ import annotations

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect


def create_dashboard_router(*, jobs, get_system_stats, logger) -> APIRouter:
    router = APIRouter()

    @router.get("/dashboard", tags=["Dashboard"])
    def dashboard():
        return get_system_stats(jobs.get_all())

    @router.websocket("/ws/dashboard")
    async def ws_dashboard(websocket: WebSocket):
        await websocket.accept()
        try:
            while True:
                await websocket.send_json(get_system_stats(jobs.get_all()))
                await asyncio.sleep(1.0)
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            logger.warning(f"ws_dashboard error: {exc}")

    return router
