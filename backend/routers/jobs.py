from __future__ import annotations

import html
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse


PLATFORM_TARGETS = {
    "spotify": {"label": "Spotify", "lufs": -14.0, "true_peak_db": -1.0},
    "youtube": {"label": "YouTube", "lufs": -14.0, "true_peak_db": -1.0},
    "apple_music": {"label": "Apple Music", "lufs": -16.0, "true_peak_db": -1.0},
    "tidal": {"label": "Tidal", "lufs": -14.0, "true_peak_db": -1.0},
    "club": {"label": "Club / DJ", "lufs": -9.0, "true_peak_db": -0.3},
    "cd": {"label": "CD", "lufs": -9.0, "true_peak_db": -0.1},
}


def _num(value, default=None):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _fmt_db(value, suffix=" dB") -> str:
    n = _num(value)
    return "—" if n is None else f"{n:+.1f}{suffix}"


def _fmt_plain(value, suffix="") -> str:
    n = _num(value)
    return "—" if n is None else f"{n:.1f}{suffix}"


def _report_payload(job_id: str, job: dict) -> dict:
    report = {
        "job_id": job_id,
        "filename": job["filename"],
        "created_at": job["created_at"],
        "finished_at": job.get("finished_at"),
        "params": job["params"],
        "analysis_before": job["result"]["analysis_before"],
        "analysis_after": job["result"]["analysis_after"],
        "mix_advice_before": job["result"]["mix_advice_before"],
        "mix_advice_after": job["result"]["mix_advice_after"],
        "recommendations_before": job["result"].get("recommendations_before"),
        "recommendations_after": job["result"].get("recommendations_after"),
        "chain_meters": job["result"].get("chain_meters", {}),
    }
    if "reference_match" in job["result"]:
        report["reference_match"] = job["result"]["reference_match"]
        report["analysis_reference"] = job["result"]["analysis_reference"]
    return report


def _platform_recommendation(params: dict, analysis_after: dict) -> dict:
    selected = params.get("platform") or params.get("target_platform")
    if selected in PLATFORM_TARGETS:
        return {"key": selected, **PLATFORM_TARGETS[selected], "reason": "Seleccionada en la cadena"}
    target_lufs = _num(params.get("target_lufs"), _num(analysis_after.get("lufs"), -14.0))
    closest_key = min(PLATFORM_TARGETS, key=lambda key: abs(PLATFORM_TARGETS[key]["lufs"] - target_lufs))
    return {"key": closest_key, **PLATFORM_TARGETS[closest_key], "reason": "Sugerida por loudness final"}


def _quality_score(analysis_after: dict, mix_advice_after: dict, platform: dict) -> tuple[int, list[dict]]:
    score = int(_num(mix_advice_after.get("score"), 100))
    lufs = _num(analysis_after.get("lufs"))
    true_peak = _num(analysis_after.get("true_peak_db"))
    crest = _num(analysis_after.get("crest_factor_db"), _num(analysis_after.get("dynamic_range_db")))
    corr = _num(analysis_after.get("stereo_correlation"))
    clip = _num(analysis_after.get("clipping_ratio"), 0.0)
    checks = [
        {
            "ok": lufs is not None and abs(lufs - platform["lufs"]) <= 1.5,
            "label": "Loudness target",
            "detail": f"{_fmt_plain(lufs, ' LUFS')} vs {platform['lufs']:+.1f} LUFS",
        },
        {
            "ok": true_peak is not None and true_peak <= platform["true_peak_db"] + 0.2,
            "label": "True peak seguro",
            "detail": f"{_fmt_db(true_peak, ' dBTP')} / ceiling {platform['true_peak_db']:+.1f} dBTP",
        },
        {"ok": crest is not None and 6.0 <= crest <= 18.0, "label": "Dinámica musical", "detail": f"crest {_fmt_db(crest)}"},
        {"ok": corr is not None and corr >= -0.15, "label": "Compatibilidad mono/fase", "detail": f"correlación {_fmt_plain(corr)}"},
        {"ok": clip <= 0.0005, "label": "Sin clipping crítico", "detail": f"clipping {clip * 100:.3f}%"},
    ]
    score -= sum(5 for check in checks if not check["ok"])
    return max(0, min(100, score)), checks


def _changes_summary(params: dict) -> list[str]:
    labels = {
        "target_lufs": "Normalización LUFS",
        "true_peak_db": "Ceiling true peak",
        "limiter_ceiling": "Limiter ceiling",
        "comp_threshold_db": "Compresión principal",
        "parallel_mix": "Compresión paralela",
        "stereo_width_amount": "Ancho estéreo",
        "saturation_mode": "Saturación",
        "eq_mode": "Modo de EQ",
        "tonal_balance_amount": "Balance tonal",
        "output_format": "Formato de exportación",
    }
    changes = []
    for key, label in labels.items():
        if key in params and params.get(key) not in (None, "", False):
            changes.append(f"{label}: {params[key]}")
    return changes[:10] or ["Cadena de mastering aplicada con los parámetros del job."]


def _spectrum_svg(before: dict, after: dict) -> str:
    bands = ["sub_bass", "bass", "low_mid", "mid", "upper_mid", "presence", "air"]
    labels = ["Sub", "Bass", "L-Mid", "Mid", "U-Mid", "Pres", "Air"]
    vals = [_num((before or {}).get(k), -90) for k in bands] + [_num((after or {}).get(k), -90) for k in bands]
    lo, hi = min(vals + [-90]), max(vals + [-20])
    span = max(1.0, hi - lo)
    bars = []
    for idx, (key, label) in enumerate(zip(bands, labels)):
        x = 36 + idx * 64
        for offset, data, color in [(0, before, "#6b7280"), (18, after, "#f0b840")]:
            val = _num((data or {}).get(key), lo)
            h = max(4, ((val - lo) / span) * 110)
            y = 140 - h
            bars.append(f'<rect x="{x + offset}" y="{y:.1f}" width="14" height="{h:.1f}" rx="4" fill="{color}"/>')
        bars.append(f'<text x="{x + 8}" y="160" text-anchor="middle" fill="#a09585" font-size="10">{label}</text>')
    return f'''<svg viewBox="0 0 500 176" role="img" aria-label="Espectro before after">
      <rect width="500" height="176" rx="18" fill="#161310"/>
      <text x="24" y="24" fill="#f5f0e8" font-size="13" font-weight="700">Espectro before/after</text>
      <text x="350" y="24" fill="#6b7280" font-size="11">Before</text><text x="410" y="24" fill="#f0b840" font-size="11">After</text>
      {''.join(bars)}
    </svg>'''


def _tonal_balance_rows(spectrum: dict) -> str:
    if not spectrum:
        return '<div class="empty">Sin datos espectrales.</div>'
    values = [_num(v, -90) for v in spectrum.values()]
    avg = sum(values) / len(values) if values else -90
    names = {"sub_bass": "Sub", "bass": "Bass", "low_mid": "L-Mid", "mid": "Mid", "upper_mid": "U-Mid", "presence": "Presence", "air": "Air"}
    rows = []
    for key, value in spectrum.items():
        delta = _num(value, avg) - avg
        cls = "hot" if delta > 4 else "cold" if delta < -4 else "ok"
        rows.append(f'<div class="tonal-pill {cls}"><span>{html.escape(names.get(key, key))}</span><b>{delta:+.1f} dB</b></div>')
    return "".join(rows)


def _render_visual_report(report: dict) -> str:
    before = report["analysis_before"]
    after = report["analysis_after"]
    advice = report.get("mix_advice_after") or {}
    params = report.get("params") or {}
    platform = _platform_recommendation(params, after)
    score, checks = _quality_score(after, advice, platform)
    grade = "A" if score >= 90 else "B" if score >= 80 else "C" if score >= 65 else "D"
    issues = advice.get("issues") or []
    tips = advice.get("tips") or []
    changes = _changes_summary(params)
    safe_name = html.escape(str(report.get("filename", "track")))
    checklist = "".join(
        f'<li class="{"pass" if check["ok"] else "warn"}"><b>{html.escape(check["label"])}</b><span>{html.escape(check["detail"])}</span></li>'
        for check in checks
    )
    changes_html = "".join(f"<li>{html.escape(item)}</li>" for item in changes)
    issues_html = "".join(f"<li>{html.escape(item)}</li>" for item in issues[:6]) or "<li>Sin issues críticos detectados.</li>"
    tips_html = "".join(f"<li>{html.escape(item)}</li>" for item in tips[:6]) or "<li>Compará contra referencias del género antes de distribuir.</li>"
    css = """
      :root{color-scheme:dark;--bg:#0e0c0a;--surface:#161310;--surface2:#1f1a14;--amber:#f0b840;--green:#4ade80;--yellow:#facc15;--red:#f43f5e;--text:#f5f0e8;--muted:#a09585;--border:rgba(255,255,255,.12)}
      *{box-sizing:border-box} body{margin:0;background:radial-gradient(circle at top,#2a2116,var(--bg) 42%);color:var(--text);font-family:Inter,system-ui,sans-serif;padding:28px}.cert{max-width:1120px;margin:auto;background:rgba(22,19,16,.92);border:1px solid var(--border);border-radius:28px;overflow:hidden;box-shadow:0 24px 90px rgba(0,0,0,.45)}
      header{padding:32px 36px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:24px;align-items:flex-start;background:linear-gradient(135deg,rgba(240,184,64,.12),transparent)} h1{margin:0;font-size:34px;letter-spacing:-.03em}.subtitle{color:var(--muted);margin-top:6px}.badge{border:1px solid rgba(240,184,64,.45);color:var(--amber);border-radius:999px;padding:8px 12px;font:700 12px ui-monospace,monospace;text-transform:uppercase;display:inline-block;margin-bottom:14px}
      .score{width:128px;height:128px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--amber) calc(var(--score)*1%),rgba(255,255,255,.08) 0);position:relative;flex:0 0 auto}.score:before{content:'';position:absolute;inset:10px;background:var(--surface);border-radius:50%}.score b,.score span{position:relative}.score b{font-size:34px}.score span{color:var(--muted);font-size:12px} main{padding:28px 36px 36px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card{background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.018));border:1px solid var(--border);border-radius:18px;padding:18px}.card h2{font-size:13px;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin:0 0 12px}.metric{font:800 25px ui-monospace,monospace}.delta{color:var(--muted);font-size:12px;margin-top:6px}.wide{grid-column:span 2}ul{padding-left:18px;margin:8px 0 0}li{margin:7px 0;color:#ddd}.checklist{list-style:none;padding:0}.checklist li{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid rgba(255,255,255,.07);padding:9px 0}.checklist li.pass b{color:var(--green)}.checklist li.warn b{color:var(--yellow)}.checklist span{color:var(--muted);text-align:right}.tonal{display:grid;grid-template-columns:repeat(7,1fr);gap:8px}.tonal-pill{border:1px solid var(--border);border-radius:14px;padding:12px 8px;text-align:center}.tonal-pill span,.tonal-pill b{display:block}.tonal-pill span{font-size:11px;color:var(--muted)}.tonal-pill.hot{background:rgba(244,63,94,.08);border-color:rgba(244,63,94,.35)}.tonal-pill.cold{background:rgba(34,211,238,.08);border-color:rgba(34,211,238,.3)}.tonal-pill.ok{background:rgba(74,222,128,.06);border-color:rgba(74,222,128,.22)}.print{position:fixed;right:18px;bottom:18px;border:0;border-radius:999px;background:var(--amber);color:#0e0c0a;font-weight:800;padding:12px 16px;cursor:pointer}@media print{body{padding:0;background:#111}.print{display:none}.cert{border-radius:0}}@media(max-width:850px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}header{display:block}.score{margin-top:18px}.tonal{grid-template-columns:repeat(2,1fr)}}
    """
    return f'''<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mastering Certificate - {safe_name}</title><style>{css}</style></head>
    <body><article class="cert"><header><div><div class="badge">Mastering Certificate</div><h1>{safe_name}</h1><div class="subtitle">Job {html.escape(report['job_id'][:8])} · {html.escape(str(report.get('finished_at') or report.get('created_at') or ''))}</div><div class="subtitle">Destino sugerido: <b>{html.escape(platform['label'])}</b> ({platform['lufs']:+.1f} LUFS / {platform['true_peak_db']:+.1f} dBTP) · {html.escape(platform['reason'])}</div></div><div class="score" style="--score:{score}"><div><b>{score}</b><br><span>Grade {grade}</span></div></div></header>
    <main><section class="grid"><div class="card"><h2>LUFS integrado</h2><div class="metric">{_fmt_plain(after.get('lufs'), ' LUFS')}</div><div class="delta">Antes: {_fmt_plain(before.get('lufs'), ' LUFS')}</div></div><div class="card"><h2>True Peak</h2><div class="metric">{_fmt_db(after.get('true_peak_db'), ' dBTP')}</div><div class="delta">Antes: {_fmt_db(before.get('true_peak_db'), ' dBTP')}</div></div><div class="card"><h2>Dynamic range</h2><div class="metric">{_fmt_db(after.get('dynamic_range_db'))}</div><div class="delta">Crest: {_fmt_db(after.get('crest_factor_db'))}</div></div><div class="card"><h2>Stereo correlation</h2><div class="metric">{_fmt_plain(after.get('stereo_correlation'))}</div><div class="delta">Mono: {_fmt_db(after.get('mono_compatibility_db'))}</div></div>
    <div class="card wide"><h2>Checklist de entrega</h2><ul class="checklist">{checklist}</ul></div><div class="card wide"><h2>Cambios principales aplicados</h2><ul>{changes_html}</ul></div><div class="card wide">{_spectrum_svg(before.get('spectrum', {}), after.get('spectrum', {}))}</div><div class="card wide"><h2>Tonal balance final</h2><div class="tonal">{_tonal_balance_rows(after.get('spectrum', {}))}</div></div><div class="card wide"><h2>Issues</h2><ul>{issues_html}</ul></div><div class="card wide"><h2>Recomendaciones</h2><ul>{tips_html}</ul></div></section></main></article><button class="print" onclick="window.print()">Imprimir / guardar PDF</button></body></html>'''


def create_jobs_router(*, jobs, sanitize_track_name) -> APIRouter:
    router = APIRouter()

    def _done_job_or_404(job_id: str) -> dict:
        if not jobs.exists(job_id):
            raise HTTPException(404, "Job no encontrado")
        job = jobs.get_job(job_id)
        if job["status"] != "done":
            raise HTTPException(400, f"Job no listo: {job['status']}")
        return job

    @router.get("/job/{job_id}", tags=["Jobs"])
    def get_job(job_id: str):
        if not jobs.exists(job_id):
            raise HTTPException(404, "Job no encontrado")
        job = jobs.get_job(job_id).copy()
        if job.get("type") == "stems":
            if job["status"] == "done":
                job["stem_download_urls"] = {
                    name: f"/stems/download/{job_id}/{name}" for name in job.get("available_stems", [])
                }
            job.pop("stem_paths", None)
            return job
        if job["status"] == "done":
            job["download_url"] = f"/download/{job_id}"
            job["report_url"] = f"/report/{job_id}"
            job["visual_report_url"] = f"/report/{job_id}/visual"
            job["analysis_before"] = job["result"].get("analysis_before")
            job["analysis_after"] = job["result"].get("analysis_after")
            job["mix_advice_before"] = job["result"].get("mix_advice_before")
            job["mix_advice_after"] = job["result"].get("mix_advice_after")
            job["recommendations_before"] = job["result"].get("recommendations_before")
            job["recommendations_after"] = job["result"].get("recommendations_after")
            job["chain_meters"] = job["result"].get("chain_meters", {})
            job["output_bit_depth"] = job["result"].get("output_bit_depth")
            if "reference_match" in job["result"]:
                job["reference_match"] = job["result"]["reference_match"]
                job["analysis_reference"] = job["result"]["analysis_reference"]
            del job["result"]
        return job

    @router.get("/download/{job_id}", tags=["Jobs"])
    def download(job_id: str, name: Optional[str] = Query(None, description="Nombre del tema para el archivo descargado")):
        job = _done_job_or_404(job_id)
        output_path = job["result"]["output_path"]
        if not os.path.exists(output_path):
            raise HTTPException(410, "Archivo expirado. Volvé a masterizar.")
        fmt = job.get("params", {}).get("output_format", "wav")
        mt = "audio/mpeg" if fmt == "mp3" else ("audio/flac" if fmt == "flac" else "audio/wav")
        track_name = sanitize_track_name(name)
        return FileResponse(output_path, media_type=mt, filename=f"{track_name}.{fmt}")

    @router.get("/report/{job_id}", tags=["Jobs"])
    def export_report(job_id: str):
        job = _done_job_or_404(job_id)
        return JSONResponse(content=_report_payload(job_id, job), headers={
            "Content-Disposition": f'attachment; filename="mastering_report_{job_id[:8]}.json"'
        })

    @router.get("/report/{job_id}/visual", response_class=HTMLResponse, tags=["Jobs"])
    def export_visual_report(job_id: str):
        job = _done_job_or_404(job_id)
        return HTMLResponse(
            content=_render_visual_report(_report_payload(job_id, job)),
            headers={"Content-Disposition": f'inline; filename="mastering_certificate_{job_id[:8]}.html"'},
        )

    @router.get("/jobs", tags=["Jobs"])
    def list_jobs():
        return [
            {"job_id": k, "status": v["status"], "filename": v["filename"], "created_at": v["created_at"]}
            for k, v in jobs.get_all().items()
        ]

    return router
