// ============================================================
// 11-ai-assistant-ux.js — Asistente de IA, sidebar tabs, UX fixes
// ============================================================

document.getElementById("metersToggle").addEventListener("click", () => {
  const body = document.getElementById("metersBody");
  const hidden = body.style.display === "none";
  body.style.display = hidden ? "block" : "none";
  document.getElementById("metersToggle").textContent = hidden ? "ocultar" : "mostrar";
});

window.addEventListener("beforeunload", () => {
  stopDashboard();
  teardownLiveMeters();
  try { stopPreviewSpectrum(); } catch (e) {}
});

// ═══════════════════════════════════════════════════════════════
// ── Asistente de IA (estilo LANDR AI) ────────────────────────
// ═══════════════════════════════════════════════════════════════

const AI_SUGGESTIONS = [
  "🤖 Masterizá esto por mí",
  "¿Cómo está el loudness de mi track?",
  "¿Qué preset me conviene?",
  "¿Tengo problemas de clipping?",
];

function aiEl(id) {
  return document.getElementById(id);
}

function setAiContext(analysisData) {
  lastAnalysisData = analysisData || null;
  const fab = aiEl("aiFab");
  if (lastAnalysisData) fab.classList.add("has-context");
  else fab.classList.remove("has-context");
}

function aiCurrentPreset() {
  const active = document.querySelector(".preset-btn.active");
  return active ? active.dataset.preset : null;
}

function aiCurrentPlatform() {
  const sel = aiEl("s-platform");
  return sel && sel.value ? sel.value : null;
}

function aiAppendMessage(role, content) {
  const wrap = aiEl("aiMessages");
  const div = document.createElement("div");
  div.className = `ai-msg ${role}`;
  div.textContent = content;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

function aiAppendSuggestionCard(suggestedParams, summary, explanation) {
  const wrap = aiEl("aiMessages");
  const card = document.createElement("div");
  card.className = "ai-suggestion-card";

  if (summary) {
    const title = document.createElement("div");
    title.className = "ai-suggestion-card-title";
    title.textContent = summary;
    card.appendChild(title);
  }

  if (explanation) {
    const explain = document.createElement("div");
    explain.className = "ai-suggestion-explanation";
    explain.textContent = explanation;
    card.appendChild(explain);
  }

  const list = document.createElement("ul");
  list.className = "ai-suggestion-card-list";
  Object.entries(suggestedParams).forEach(([key, value]) => {
    const li = document.createElement("li");
    const label = PARAM_LABELS[key] || key;
    let valueText;
    if (typeof value === "boolean") {
      valueText = value ? "activado" : "desactivado";
    } else if (typeof value === "string") {
      valueText = value;
    } else {
      valueText = formatParamValue(value, key);
    }
    li.innerHTML = `<span class="ai-suggestion-param">${label}</span><span class="ai-suggestion-value">${valueText}</span>`;
    list.appendChild(li);
  });
  card.appendChild(list);

  const actions = document.createElement("div");
  actions.className = "ai-suggestion-card-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "ai-suggestion-cancel-btn";
  cancelBtn.textContent = "Cancelar";
  cancelBtn.addEventListener("click", () => {
    card.remove();
  });
  actions.appendChild(cancelBtn);

  const applyBtn = document.createElement("button");
  applyBtn.className = "ai-suggestion-apply-btn";
  applyBtn.textContent = "Confirmar cambios";
  applyBtn.addEventListener("click", () => {
    applyPresetToUI(suggestedParams);
    activePreset = null;
    document.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
    applyBtn.textContent = "✓ Aplicado";
    applyBtn.disabled = true;
    cancelBtn.disabled = true;
    card.classList.add("applied");
  });
  actions.appendChild(applyBtn);
  card.appendChild(actions);

  wrap.appendChild(card);
  wrap.scrollTop = wrap.scrollHeight;
}

function aiAppendNote(content) {
  const wrap = aiEl("aiMessages");
  const div = document.createElement("div");
  div.className = "ai-msg system-note";
  div.textContent = content;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

function aiShowTyping() {
  const wrap = aiEl("aiMessages");
  const div = document.createElement("div");
  div.className = "ai-msg assistant typing";
  div.id = "aiTypingIndicator";
  div.innerHTML = "<span></span><span></span><span></span>";
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

function aiHideTyping() {
  const el = aiEl("aiTypingIndicator");
  if (el) el.remove();
}

function aiRenderSuggestions() {
  const box = aiEl("aiSuggestions");
  box.innerHTML = "";
  AI_SUGGESTIONS.forEach((s) => {
    const btn = document.createElement("button");
    btn.className = "ai-suggestion-btn";
    btn.textContent = s;
    btn.addEventListener("click", () => {
      if (s.includes("Masterizá esto por mí")) {
        if (!selectedFile) {
          aiAppendNote("Primero subí un archivo de audio para poder masterizarlo.");
          return;
        }
        document.getElementById("btnAutoMaster").click();
        return;
      }
      aiEl("aiInput").value = s;
      aiSendMessage();
    });
    box.appendChild(btn);
  });
}

async function aiCheckStatus() {
  try {
    const res = await fetch(`${API()}/ai/status`);
    const data = await res.json();
    aiAvailable = !!data.available;
    aiEl("aiStatusLine").textContent = aiAvailable
      ? lastAnalysisData
        ? "Analizando tu track"
        : "Listo para ayudarte"
      : "No configurado";
    aiEl("aiSend").disabled = !aiAvailable;
    if (!aiAvailable) {
      aiAppendNote(data.reason || "El asistente de IA no está configurado en el backend (falta GEMINI_API_KEY).");
    }
  } catch (e) {
    aiAvailable = false;
    aiEl("aiStatusLine").textContent = "Sin conexión al backend";
    aiEl("aiSend").disabled = true;
    aiAppendNote("No se pudo conectar con el backend (" + API() + ") para consultar el asistente.");
  }
}

async function aiSendMessage() {
  const input = aiEl("aiInput");
  const msg = input.value.trim();
  if (!msg || aiEl("aiSend").disabled) return;
  input.value = "";
  input.style.height = "auto";
  aiAppendMessage("user", msg);
  aiEl("aiSuggestions").innerHTML = "";
  aiShowTyping();
  aiEl("aiSend").disabled = true;

  try {
    const res = await fetch(`${API()}/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: msg,
        history: aiChatHistory,
        analysis: lastAnalysisData,
        preset: aiCurrentPreset(),
        platform: aiCurrentPlatform(),
      }),
    });
    aiHideTyping();
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const data = await res.json();
    aiAppendMessage("assistant", data.reply);
    if (data.suggested_params && Object.keys(data.suggested_params).length) {
      aiAppendSuggestionCard(data.suggested_params, data.suggestion_summary, data.suggestion_explanation);
    }
    aiChatHistory.push({ role: "user", content: msg });
    aiChatHistory.push({ role: "assistant", content: data.reply });
  } catch (e) {
    aiHideTyping();
    console.error("Error en /ai/chat:", e);
    aiAppendNote("Error consultando al asistente: " + e.message);
  } finally {
    aiEl("aiSend").disabled = false;
  }
}

aiEl("aiFab").addEventListener("click", () => {
  const panel = aiEl("aiPanel");
  const opening = !panel.classList.contains("open");
  panel.classList.toggle("open");
  if (opening) {
    if (aiAvailable === null) {
      aiAppendMessage(
        "assistant",
        "¡Hola! Soy tu asistente de mastering. Puedo analizar tu track y darte consejos, o directamente masterizarlo por vos: elijo preset, plataforma target y ajustes de nivel según el análisis técnico. ¿En qué te ayudo?",
      );
      aiRenderSuggestions();
      aiCheckStatus();
    }
    aiEl("aiInput").focus();
  }
});

aiEl("aiClose").addEventListener("click", () => aiEl("aiPanel").classList.remove("open"));
aiEl("aiSend").addEventListener("click", aiSendMessage);
aiEl("aiInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    aiSendMessage();
  }
});
aiEl("aiInput").addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 96) + "px";
});

// ── Sidebar tabs ──────────────────────────────────────────────
(function () {
  const tabs = document.querySelectorAll("#sidebarTabs .sidebar-tab");
  const container = document.getElementById("sidebarPaneContainer");
  const paneMap = { "pane-archivo": "archivo", "pane-cadena": "cadena", "pane-salida": "salida" };
  const detailsMap = { "pane-archivo": "pasoArchivo", "pane-cadena": "pasoCadena", "pane-salida": "pasoSalida" };

  function switchTab(tab) {
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const pane = tab.dataset.pane;
    const cls = paneMap[pane];
    container.className = container.className.replace(/sidebar-showing-\w+/g, "").trim();
    container.classList.add("sidebar-showing-" + cls);
    const det = document.getElementById(detailsMap[pane]);
    if (det && !det.open) det.setAttribute("open", "");
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => switchTab(tab)));
  const paso1 = document.getElementById("pasoArchivo");
  const paso2 = document.getElementById("pasoCadena");
  const paso3 = document.getElementById("pasoSalida");
  if (paso1) paso1.setAttribute("open", "");
  if (paso2) paso2.removeAttribute("open");
  if (paso3) paso3.removeAttribute("open");
})();

// ── UX Fix 1: Toggle DEV panel ──────────────────────────────
(function () {
  const btn = document.getElementById("devToggleBtn");
  const wrap = document.getElementById("apiUrlWrap");
  let visible = false;
  btn.addEventListener("click", () => {
    visible = !visible;
    wrap.style.display = visible ? "inline-flex" : "none";
    btn.style.borderColor = visible ? "var(--accent)" : "";
    btn.style.color = visible ? "var(--accent)" : "";
    if (visible) document.getElementById("apiUrl").focus();
  });
})();

// ── UX Fix 2: Indicador de scroll ────────────────────────────
(function () {
  const aside = document.querySelector("aside");
  const hint = document.getElementById("asideScrollHint");
  if (!aside || !hint) return;
  function updateScrollHint() {
    const atBottom = aside.scrollHeight - aside.scrollTop - aside.clientHeight < 20;
    hint.classList.toggle("hidden", atBottom);
  }
  aside.addEventListener("scroll", updateScrollHint, { passive: true });
  updateScrollHint();
  new ResizeObserver(updateScrollHint).observe(aside);
})();

// ── UX Fix 4: Revelar botones secundarios ────────────────────
(function () {
  const secondaryBtns = ["btnAutoMaster", "btnAiSuggest", "btnAnalyze", "btnAdvice", "btnAnalyzeGrid", "btnAdviceGrid", "btnSpectrum", "btnStems", "btnAB"];
  const observer = new MutationObserver(() => {
    if (selectedFile) {
      secondaryBtns.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = "";
      });
    }
  });
  const masterBtn = document.getElementById("btnMaster");
  if (masterBtn) {
    observer.observe(masterBtn, { attributes: true, attributeFilter: ["disabled"] });
  }
})();

// ── UX Fix 5: eliminado (código muerto removido) ─────────────
// Se eliminó la línea que hacía referencia a window._origSetFile