// §8.4a.25 — Universal 🚩 feedback button.
//
// Drop-in vanilla JS. Each SpaceSC surface includes:
//   <script src="/feedback-button.js" defer></script>
// and on load this self-injects a fixed top-right 🚩 button + modal sheet.
//
// Design contract:
// - ALWAYS visible (z-index above NavMenu pill); never hidden by content
// - localStorage offline queue: if /api/feedback-capture 502/network-errs,
//   the entry persists and re-drains on next page visibility/online event
// - Optional voice path: MediaRecorder → POST to /api/tts-transcribe (Whisper)
// - Surfaces set window.SPACESC_FEEDBACK_CONTEXT for richer view-state capture
//
// F6 mitigation: no dead-end states. If you can see this button, you can
// always capture something. Loss of network = queued, not lost.

(function () {
  "use strict";

  const BASE = window.SPACESC_WORKER_BASE || "https://spacesc-mcp.75xnd2784n.workers.dev";
  const TOKEN_KEYS = ["spacesc_mcp_token", "spacesc_token", "spacesc_player_token"];
  const PENDING_KEY = "spacesc_pending_feedback";
  const TOKEN_TTL_DAYS = 60;

  // -- Token retrieval (matches existing /uc3 + /desk surfaces) --
  function getToken() {
    for (const k of TOKEN_KEYS) {
      const t = localStorage.getItem(k);
      if (t) return t;
    }
    return null;
  }

  // -- Context capture --
  function captureContext() {
    const ctx = {
      url: window.location.pathname + window.location.search + window.location.hash,
      surface: window.location.pathname || "/",
      title: document.title || "",
      timestamp: Math.floor(Date.now() / 1000),
      user_agent: navigator.userAgent.slice(0, 200),
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
    // Surfaces can decorate this with currently-playing-module, current-view, etc.
    // They set window.SPACESC_FEEDBACK_CONTEXT to either an object or a function
    // returning an object. The function form lets the surface compute fresh
    // state at capture time (e.g. read from React state).
    const extra = window.SPACESC_FEEDBACK_CONTEXT;
    try {
      if (typeof extra === "function") {
        Object.assign(ctx, extra() || {});
      } else if (extra && typeof extra === "object") {
        Object.assign(ctx, extra);
      }
    } catch (e) {
      ctx._context_capture_error = String(e).slice(0, 200);
    }
    return ctx;
  }

  // -- Offline queue --
  function pendingLoad() {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }
  function pendingSave(arr) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(arr)); } catch (_) {}
  }
  function pendingAdd(payload) {
    const arr = pendingLoad();
    arr.push({ local_id: "local-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8), payload });
    pendingSave(arr);
  }
  async function pendingDrain() {
    const token = getToken();
    if (!token) return;
    const arr = pendingLoad();
    if (arr.length === 0) return;
    const remaining = [];
    for (const item of arr) {
      try {
        const r = await fetch(BASE + "/api/feedback-capture", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
          body: JSON.stringify(item.payload),
          signal: AbortSignal.timeout(15000),
        });
        if (r.ok || r.status === 400) {
          // 400 = bad payload; drop so we don't loop forever
          continue;
        }
        remaining.push(item);
      } catch (_) {
        remaining.push(item);
      }
    }
    pendingSave(remaining);
  }

  // -- Submit --
  async function submitFeedback(type, notes, viewCtx) {
    const payload = {
      surface: viewCtx.surface,
      view_state_json: viewCtx,
      type,
      notes_text: notes,
      user_agent: viewCtx.user_agent,
      captured_at: viewCtx.timestamp,
    };
    const token = getToken();
    if (!token) {
      pendingAdd(payload);
      return { queued_offline: true, reason: "no_token" };
    }
    try {
      const r = await fetch(BASE + "/api/feedback-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) return await r.json();
      // 5xx or network failure: queue
      if (r.status >= 500 || r.status === 0) {
        pendingAdd(payload);
        return { queued_offline: true, reason: "http_" + r.status };
      }
      // 4xx other than auth: surface error
      const txt = await r.text().catch(() => "");
      throw new Error("HTTP " + r.status + " " + txt.slice(0, 200));
    } catch (e) {
      pendingAdd(payload);
      return { queued_offline: true, reason: e.message || "network" };
    }
  }

  // -- Voice recording (optional path) --
  let mediaRecorder = null;
  let recordedChunks = [];
  async function startVoice() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("microphone not supported in this browser");
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.start();
  }
  function stopVoice() {
    return new Promise((resolve, reject) => {
      if (!mediaRecorder) return reject(new Error("not recording"));
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: "audio/webm" });
        mediaRecorder.stream.getTracks().forEach((t) => t.stop());
        mediaRecorder = null;
        resolve(blob);
      };
      mediaRecorder.stop();
    });
  }
  // Voice path: pseudo-transcribe by uploading. The worker side has /api/tts-chunked
  // but no whisper endpoint yet. For v1 we just store the audio and let the
  // notes_text carry a placeholder + the user types in their issue. Audio is
  // optional context for Claude Code to listen to later.
  // TODO §8.4a.25.1: add /api/whisper-transcribe and chain it here.

  // -- DOM injection --
  function injectStyles() {
    if (document.getElementById("spacesc-feedback-styles")) return;
    const css = `
      .ssc-feedback-btn {
        position: fixed; top: 14px; right: 70px; z-index: 9999;
        width: 44px; height: 44px; border-radius: 50%;
        background: rgba(220, 75, 75, 0.92);
        color: #fff; border: none; cursor: pointer;
        font-size: 22px; line-height: 44px; text-align: center;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        transition: transform 0.15s, background 0.15s;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        padding: 0;
      }
      .ssc-feedback-btn:hover { transform: scale(1.08); background: rgba(220, 75, 75, 1); }
      .ssc-feedback-btn:active { transform: scale(0.95); }
      .ssc-feedback-pending-dot {
        position: absolute; top: -2px; right: -2px;
        width: 14px; height: 14px; border-radius: 50%;
        background: #ffb84d; color: #000; font-size: 9px;
        line-height: 14px; text-align: center; font-weight: 700;
        border: 1.5px solid #fff;
      }
      .ssc-feedback-overlay {
        position: fixed; inset: 0; z-index: 10000;
        background: rgba(0,0,0,0.5); display: none;
        align-items: flex-end; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      }
      .ssc-feedback-overlay.open { display: flex; }
      .ssc-feedback-sheet {
        background: #fff; color: #1a1a1a;
        width: 100%; max-width: 480px;
        border-radius: 16px 16px 0 0;
        padding: 22px 20px 32px;
        max-height: 88vh; overflow-y: auto;
        box-shadow: 0 -4px 20px rgba(0,0,0,0.3);
      }
      .ssc-feedback-sheet h3 {
        margin: 0 0 6px; font-size: 17px; font-weight: 600;
      }
      .ssc-feedback-sub {
        font-size: 12px; color: #666; margin-bottom: 16px; line-height: 1.4;
      }
      .ssc-feedback-types {
        display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px;
      }
      .ssc-feedback-type {
        padding: 10px 12px; border: 1.5px solid #e0e0e0; border-radius: 10px;
        background: #fafafa; cursor: pointer; font-size: 14px;
        display: flex; align-items: center; gap: 8px;
        transition: all 0.12s; font-weight: 500; color: #1a1a1a;
      }
      .ssc-feedback-type:hover { border-color: #999; background: #f5f5f5; }
      .ssc-feedback-type.selected {
        border-color: #dc4b4b; background: rgba(220,75,75,0.08); color: #b03434;
      }
      .ssc-feedback-textarea {
        width: 100%; min-height: 100px; padding: 12px;
        border: 1.5px solid #e0e0e0; border-radius: 10px;
        font-size: 14px; font-family: inherit; resize: vertical;
        box-sizing: border-box; color: #1a1a1a;
      }
      .ssc-feedback-textarea:focus { outline: none; border-color: #dc4b4b; }
      .ssc-feedback-actions {
        display: flex; gap: 8px; margin-top: 14px; justify-content: flex-end;
      }
      .ssc-feedback-cancel, .ssc-feedback-submit {
        padding: 10px 18px; border-radius: 8px; font-size: 14px;
        cursor: pointer; border: none; font-weight: 500;
      }
      .ssc-feedback-cancel { background: #f0f0f0; color: #333; }
      .ssc-feedback-submit { background: #dc4b4b; color: #fff; }
      .ssc-feedback-submit:disabled { background: #bbb; cursor: not-allowed; }
      .ssc-feedback-context {
        background: #f7f7f7; border-radius: 8px; padding: 10px 12px;
        font-size: 11px; color: #555; line-height: 1.4; margin-bottom: 14px;
        font-family: ui-monospace, "SF Mono", monospace;
      }
      .ssc-feedback-context strong { color: #1a1a1a; font-family: inherit; }
      .ssc-feedback-toast {
        position: fixed; top: 70px; right: 14px; z-index: 10001;
        background: rgba(40,40,40,0.95); color: #fff;
        padding: 10px 16px; border-radius: 8px; font-size: 13px;
        box-shadow: 0 2px 12px rgba(0,0,0,0.4);
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        max-width: 320px;
      }
      @media (prefers-color-scheme: dark) {
        .ssc-feedback-sheet { background: #1f1f1f; color: #f0f0f0; }
        .ssc-feedback-type { background: #2a2a2a; border-color: #3a3a3a; color: #f0f0f0; }
        .ssc-feedback-type:hover { background: #333; border-color: #555; }
        .ssc-feedback-type.selected { background: rgba(220,75,75,0.18); color: #ff8c8c; }
        .ssc-feedback-textarea { background: #2a2a2a; border-color: #3a3a3a; color: #f0f0f0; }
        .ssc-feedback-cancel { background: #333; color: #f0f0f0; }
        .ssc-feedback-context { background: #2a2a2a; color: #aaa; }
        .ssc-feedback-context strong { color: #f0f0f0; }
        .ssc-feedback-sub { color: #999; }
      }
    `;
    const style = document.createElement("style");
    style.id = "spacesc-feedback-styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function showToast(msg, ms) {
    const t = document.createElement("div");
    t.className = "ssc-feedback-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.remove(); }, ms || 3500);
  }

  let openOverlay = null;
  function closeSheet() {
    if (openOverlay) {
      openOverlay.remove();
      openOverlay = null;
    }
  }
  function openSheet() {
    if (openOverlay) return;
    const ctx = captureContext();
    const overlay = document.createElement("div");
    overlay.className = "ssc-feedback-overlay open";
    overlay.innerHTML = `
      <div class="ssc-feedback-sheet" role="dialog" aria-label="Report something">
        <h3>What did you spot?</h3>
        <div class="ssc-feedback-sub">Pick one. Then describe in a sentence — Claude will pick this up next session with the full context already captured.</div>
        <div class="ssc-feedback-context">
          <strong>Where:</strong> ${ctx.surface}${ctx.title ? " · " + ctx.title.slice(0, 50) : ""}<br>
          <strong>When:</strong> ${new Date(ctx.timestamp * 1000).toLocaleString()}
          ${renderExtraCtx(ctx)}
        </div>
        <div class="ssc-feedback-types" role="radiogroup">
          <div class="ssc-feedback-type" data-type="bug" role="radio">🐛 Bug</div>
          <div class="ssc-feedback-type" data-type="confusion" role="radio">🤔 Confusion</div>
          <div class="ssc-feedback-type" data-type="feature" role="radio">✨ Feature</div>
          <div class="ssc-feedback-type" data-type="question" role="radio">❓ Question</div>
        </div>
        <textarea class="ssc-feedback-textarea" placeholder="What's wrong / what would you want here? (Be brief — Claude has the screen + state.)"></textarea>
        <div class="ssc-feedback-actions">
          <button class="ssc-feedback-cancel" type="button">Cancel</button>
          <button class="ssc-feedback-submit" type="button" disabled>Send</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    openOverlay = overlay;

    let selectedType = null;
    const typeBtns = overlay.querySelectorAll(".ssc-feedback-type");
    const textarea = overlay.querySelector(".ssc-feedback-textarea");
    const submitBtn = overlay.querySelector(".ssc-feedback-submit");
    const cancelBtn = overlay.querySelector(".ssc-feedback-cancel");

    function refreshSubmit() {
      submitBtn.disabled = !(selectedType && textarea.value.trim().length > 0);
    }
    typeBtns.forEach((b) => {
      b.addEventListener("click", () => {
        typeBtns.forEach((x) => x.classList.remove("selected"));
        b.classList.add("selected");
        selectedType = b.dataset.type;
        refreshSubmit();
      });
    });
    textarea.addEventListener("input", refreshSubmit);
    cancelBtn.addEventListener("click", closeSheet);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeSheet(); });
    document.addEventListener("keydown", function escClose(e) {
      if (e.key === "Escape") { closeSheet(); document.removeEventListener("keydown", escClose); }
    });

    submitBtn.addEventListener("click", async () => {
      if (!selectedType || !textarea.value.trim()) return;
      submitBtn.textContent = "Sending…";
      submitBtn.disabled = true;
      const r = await submitFeedback(selectedType, textarea.value.trim(), ctx);
      closeSheet();
      if (r.queued_offline) {
        showToast("Saved locally — will send when online (" + r.reason + ")", 4500);
        updatePendingDot();
      } else if (r.ok) {
        showToast("Captured · #" + (r.result && r.result.feedback_id) + " · Claude will see this next session", 4000);
        updatePendingDot();
      } else {
        showToast("Submission failed: " + (r.error || "unknown") + " — saved locally", 5000);
        updatePendingDot();
      }
    });

    // Autofocus textarea after a tick (iOS-safe)
    setTimeout(() => { try { textarea.focus(); } catch (_) {} }, 50);
  }

  function renderExtraCtx(ctx) {
    const extra = [];
    if (ctx.currently_playing_module) extra.push(`<strong>Playing:</strong> module ${ctx.currently_playing_module}`);
    if (ctx.current_series) extra.push(`<strong>Series:</strong> ${escapeHtml(String(ctx.current_series).slice(0, 60))}`);
    if (ctx.current_view) extra.push(`<strong>View:</strong> ${escapeHtml(String(ctx.current_view).slice(0, 40))}`);
    if (extra.length === 0) return "";
    return "<br>" + extra.join(" · ");
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function updatePendingDot() {
    const btn = document.querySelector(".ssc-feedback-btn");
    if (!btn) return;
    btn.querySelectorAll(".ssc-feedback-pending-dot").forEach((n) => n.remove());
    const n = pendingLoad().length;
    if (n > 0) {
      const dot = document.createElement("span");
      dot.className = "ssc-feedback-pending-dot";
      dot.textContent = String(n);
      dot.title = n + " queued — will send when online";
      btn.appendChild(dot);
    }
  }

  function injectButton() {
    if (document.querySelector(".ssc-feedback-btn")) return;
    const btn = document.createElement("button");
    btn.className = "ssc-feedback-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", "Report bug / confusion / feature / question");
    btn.title = "Report something (bug · confusion · feature · question)";
    btn.textContent = "🚩";
    btn.addEventListener("click", openSheet);
    document.body.appendChild(btn);
    updatePendingDot();
  }

  function init() {
    injectStyles();
    injectButton();
    pendingDrain().catch(() => {});
    window.addEventListener("online", () => pendingDrain().catch(() => {}));
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) pendingDrain().catch(() => {});
    });
    // Expose programmatic open for surfaces that want their own trigger.
    window.SPACESC_OPEN_FEEDBACK = openSheet;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
