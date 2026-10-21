/* ==========================================================
   Mein Tag – App-Kern
   - Store: zentraler Zustand aller Sammlungen, optimistische
     Änderungen, Synchronisation mit dem Server
   - Router: Hash-Routen (#/tagebuch, #/training, …)
   - Komponenten: Sheet, Bestätigung, Toast, Formular-Helfer
   - Dynamic Island: Kontext + Navigation
   - PIN-Sperre & Push
   ========================================================== */

(function () {
  "use strict";

  const M = window.LifeModel;
  const S = window.AufwindSchedule;

  /* =========================================================
     Hilfen
     ========================================================= */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const esc = (v) => String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  const WD_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

  const today = () => M.nowInGermany().date;
  const nowMinutes = () => { const n = M.nowInGermany(); return n.hour * 60 + n.minute; };

  function fmtLong(iso) {
    const d = M.parseISO(iso);
    if (!d) return "";
    return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]}`;
  }
  function fmtShort(iso) {
    const d = M.parseISO(iso);
    return d ? `${M.pad(d.getUTCDate())}.${M.pad(d.getUTCMonth() + 1)}.` : "";
  }
  function fmtDate(iso) {
    const d = M.parseISO(iso);
    return d ? `${M.pad(d.getUTCDate())}.${M.pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}` : "";
  }
  function relDay(iso) {
    const diff = Math.round((M.parseISO(iso) - M.parseISO(today())) / 86400000);
    if (diff === 0) return "Heute";
    if (diff === 1) return "Morgen";
    if (diff === -1) return "Gestern";
    return `${WD_SHORT[M.parseISO(iso).getUTCDay()]}, ${fmtShort(iso)}`;
  }
  const minutesOf = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
    return m ? +m[1] * 60 + +m[2] : null;
  };
  const fmtMinutes = (min) => {
    const m = Math.round(Number(min) || 0);
    return `${Math.floor(m / 60)} h ${M.pad(m % 60)} min`;
  };

  /** Zahl in deutscher oder englischer Schreibweise: "12000,00", "12.000,5", "8139.53", "12.000 €" */
  function parseDE(raw) {
    let s = String(raw ?? "").replace(/[\s€%]/g, "").replace(/[^\d.,+-]/g, "");
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^[+-]?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  /** Formular → Objekt (Zahlenfelder mit data-number). */
  function formData(form) {
    const out = {};
    $$("input, select, textarea", form).forEach((el) => {
      if (!el.name) return;
      if (el.type === "checkbox") out[el.name] = el.checked;
      else if (el.dataset.number !== undefined) out[el.name] = el.value.trim() === "" ? "" : parseDE(el.value);
      else out[el.name] = el.value.trim();
    });
    return out;
  }

  /* =========================================================
     API & PIN
     ========================================================= */

  const PIN_KEY = "meintag_pin";

  function getPin() {
    try { return sessionStorage.getItem(PIN_KEY) || localStorage.getItem(PIN_KEY) || ""; } catch (e) { return ""; }
  }
  function setPin(pin, remember) {
    try {
      if (!pin) { sessionStorage.removeItem(PIN_KEY); localStorage.removeItem(PIN_KEY); return; }
      sessionStorage.setItem(PIN_KEY, pin);
      if (remember) localStorage.setItem(PIN_KEY, pin);
    } catch (e) { /* ignorieren */ }
  }

  class ApiError extends Error {
    constructor(status, data) { super("API " + status); this.status = status; this.data = data || {}; }
  }

  async function api(method, path, body) {
    let res;
    try {
      res = await fetch("/api" + path, {
        method,
        headers: { "content-type": "application/json", "x-pin": getPin() },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store"
      });
    } catch (e) {
      setSync("offline");
      throw new ApiError(0, { error: "network" });
    }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.status === 401) { onUnauthorized(); throw new ApiError(401, data); }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }

  /* =========================================================
     Store
     ========================================================= */

  const COLLECTIONS = ["entries", "sleep", "runs", "runPlan", "plans", "sessions", "events", "todos", "tags", "goals", "projects", "ideas", "sketches", "feedback", "settings", "bodyweight", "photos"];
  const state = Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
  const versions = {};
  const listeners = new Set();
  let pending = 0;
  let loaded = false;
  let followups = [];
  let followupsError = "";

  const store = {
    get loaded() { return loaded; },
    all: (col) => state[col] || [],
    get: (col, id) => (state[col] || []).find((x) => x.id === id) || null,
    data: () => state,
    followups: () => followups,
    followupsError: () => followupsError,

    /** Element anlegen oder ändern (sofort sichtbar, dann gespeichert). */
    async upsert(col, item) {
      const saved = { ...item, id: item.id || uid() };
      const list = state[col];
      const idx = list.findIndex((x) => x.id === saved.id);
      const before = idx >= 0 ? list[idx] : null;
      if (idx >= 0) list[idx] = { ...before, ...saved }; else list.push(saved);
      emit();
      track(+1);
      try {
        const res = await api("POST", `/data/${col}`, { op: "upsert", item: idx >= 0 ? list[idx] : saved });
        const i = state[col].findIndex((x) => x.id === saved.id);
        if (i >= 0) state[col][i] = res.item;
        acceptVersion(col, res.version);
        emit();
        return res.item;
      } catch (err) {
        const i = state[col].findIndex((x) => x.id === saved.id);
        if (before) state[col][i] = before; else if (i >= 0) state[col].splice(i, 1);
        emit();
        saveError(err);
        throw err;
      } finally { track(-1); }
    },

    async remove(col, id) {
      const idx = state[col].findIndex((x) => x.id === id);
      if (idx < 0) return;
      const [removed] = state[col].splice(idx, 1);
      emit();
      track(+1);
      try {
        const res = await api("POST", `/data/${col}`, { op: "delete", id });
        acceptVersion(col, res.version);
      } catch (err) {
        state[col].splice(idx, 0, removed);
        emit();
        saveError(err);
        throw err;
      } finally { track(-1); }
    },

    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };

  function emit() { listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }

  function track(delta) {
    pending += delta;
    setSync(pending > 0 ? "saving" : "ok");
  }

  function acceptVersion(col, v) {
    if (v === (versions[col] || 0) + 1) versions[col] = v;
    else sync(); // jemand anderes (anderes Gerät) hat zwischendurch geändert
  }

  function saveError(err) {
    if (err && err.status === 401) return;
    toast(err && err.status === 0 ? "Keine Verbindung – nicht gespeichert." : "Speichern fehlgeschlagen.", true);
  }

  let syncing = null;
  function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      const res = await api("GET", "/sync?v=" + encodeURIComponent(JSON.stringify(versions)));
      if (pending > 0) return false;
      let changed = false;
      Object.entries(res.cols || {}).forEach(([col, data]) => {
        if (!state[col]) return;
        state[col] = data.items || [];
        versions[col] = data.version;
        changed = true;
      });
      loaded = true;
      setSync("ok");
      if (changed) emit();
      return changed;
    })().finally(() => { syncing = null; });
    return syncing;
  }

  async function loadFollowups() {
    try {
      const res = await api("GET", "/followups");
      followups = res.items || [];
      followupsError = res.error || "";
      emit();
    } catch (e) { /* offline */ }
  }

  function setSync(s) {
    const el = $("#syncDot");
    if (!el) return;
    el.dataset.state = s;
    el.title = { ok: "Synchronisiert", saving: "Speichert …", offline: "Offline" }[s] || "";
  }

  /* =========================================================
     Komponenten: Toast, Sheet, Bestätigung
     ========================================================= */

  let toastTimer;
  function toast(msg, isError = false) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.toggle("is-error", isError);
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-visible"), isError ? 3800 : 2200);
  }

  /**
   * Sheet (unten auf dem Handy, mittig am Rechner).
   * opts: { title, body (HTML), submitLabel, onSubmit(data, form) → false = offen lassen,
   *         onDelete, deleteLabel, onMount(el, close), wide }
   */
  function sheet(opts) {
    const scrim = document.createElement("div");
    scrim.className = "sheet-scrim";
    const el = document.createElement("div");
    el.className = "sheet";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.innerHTML = `
      <div class="sheet-grip"></div>
      <form class="sheet-form" novalidate style="display:flex;flex-direction:column;min-height:0">
        <div class="sheet-head"><h2>${esc(opts.title || "")}</h2><button type="button" class="icon-btn" data-close aria-label="Schließen">×</button></div>
        <div class="sheet-body"><div class="form">${opts.body || ""}</div></div>
        ${opts.onSubmit || opts.onDelete ? `<div class="sheet-foot">
          ${opts.onDelete ? `<button type="button" class="btn btn--danger btn--sm" data-delete>${esc(opts.deleteLabel || "Löschen")}</button>` : ""}
          <span class="spacer"></span>
          ${opts.onSubmit ? `<button type="submit" class="btn btn--primary">${esc(opts.submitLabel || "Speichern")}</button>` : ""}
        </div>` : ""}
      </form>`;
    document.body.append(scrim, el);
    document.body.classList.add("no-scroll");
    requestAnimationFrame(() => { scrim.classList.add("is-open"); el.classList.add("is-open"); });
    const form = $("form", el);

    const close = () => {
      scrim.classList.remove("is-open");
      el.classList.remove("is-open");
      document.body.classList.remove("no-scroll");
      document.removeEventListener("keydown", onKey);
      setTimeout(() => { scrim.remove(); el.remove(); }, 450);
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    scrim.addEventListener("click", close);
    $$("[data-close]", el).forEach((b) => b.addEventListener("click", close));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!opts.onSubmit) return;
      const keep = await opts.onSubmit(formData(form), form, close);
      if (keep !== false) close();
    });
    const del = $("[data-delete]", el);
    if (del) del.addEventListener("click", async () => {
      const ok = await confirmDialog(opts.deleteConfirm || "Wirklich löschen?");
      if (ok) { await opts.onDelete(); close(); }
    });
    if (opts.onMount) opts.onMount(el, close);
    setTimeout(() => { const f = $("[autofocus]", el); if (f) f.focus(); }, 350);
    return { el, close };
  }

  function confirmDialog(message, { confirmLabel = "Löschen", danger = true } = {}) {
    return new Promise((resolve) => {
      let answered = false;
      const s = sheet({
        title: message,
        body: "",
        onMount(el, close) {
          $(".sheet-body", el).remove();
          const foot = document.createElement("div");
          foot.className = "sheet-foot";
          foot.innerHTML = `<span class="spacer"></span><button type="button" class="btn btn--soft" data-no>Abbrechen</button>
            <button type="button" class="btn ${danger ? "btn--primary" : "btn--accent"}" data-yes style="${danger ? "background:var(--bad);color:#fff" : ""}">${esc(confirmLabel)}</button>`;
          $("form", el).append(foot);
          $("[data-no]", el).onclick = () => { answered = true; resolve(false); close(); };
          $("[data-yes]", el).onclick = () => { answered = true; resolve(true); close(); };
          el.addEventListener("transitionend", () => { if (!el.isConnected && !answered) resolve(false); });
        }
      });
      // Schließen per Hintergrund/Escape = Nein
      const obs = new MutationObserver(() => { if (!s.el.isConnected) { obs.disconnect(); if (!answered) resolve(false); } });
      obs.observe(document.body, { childList: true });
    });
  }

  /** Slider-Füllung aktualisieren */
  function bindSliders(root) {
    $$('input[type="range"]', root).forEach((r) => {
      const update = () => {
        const pct = ((r.value - r.min) / (r.max - r.min)) * 100;
        r.style.setProperty("--fill-pct", pct + "%");
        const out = r.parentElement.querySelector("output");
        if (out) out.textContent = r.value;
      };
      r.addEventListener("input", update);
      update();
    });
  }

  /* =========================================================
     Router
     ========================================================= */

  const routes = [];
  let current = null;

  /** Route registrieren: pattern z. B. "/training/session/:id" */
  function route(pattern, view) {
    const keys = [];
    const re = new RegExp("^" + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return "/([^/]+)"; }) + "/?$");
    routes.push({ re, keys, view, pattern });
  }

  function parseHash() {
    const raw = (location.hash || "#/").slice(1) || "/";
    const [path, query] = raw.split("?");
    return { path: path || "/", query: new URLSearchParams(query || "") };
  }

  function render(force = true) {
    const { path, query } = parseHash();
    for (const r of routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const same = current && current.pattern === r.pattern && current.path === path;
      if (!force && same && r.view.autoRefresh === false) return;
      if (!force && same && document.activeElement && $("#view").contains(document.activeElement) &&
          /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return; // Eingabe nicht unterbrechen
      const scroll = same ? window.scrollY : 0;
      if (current && current.cleanup) current.cleanup();
      current = { pattern: r.pattern, path, params, view: r.view };
      const view = $("#view");
      view.innerHTML = `<div class="${same ? "" : "view"}">${r.view.render(params, query)}</div>`;
      if (r.view.mount) current.cleanup = r.view.mount(view, params, query) || null;
      bindSliders(view);
      window.scrollTo(0, scroll);
      updateIsland();
      return;
    }
    location.hash = "#/";
  }

  const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

  /* =========================================================
     Dynamic Island
     ========================================================= */

  const NAV = [
    { href: "#/", ico: "☀︎", label: "Heute" },
    { href: "#/tagebuch", ico: "✎", label: "Tagebuch" },
    { href: "#/kalender", ico: "◫", label: "Kalender" },
    { href: "#/todos", ico: "✓", label: "To-dos" },
    { href: "#/training", ico: "◆", label: "Training" },
    { href: "#/laufen", ico: "➚", label: "Laufen" },
    { href: "#/schlaf", ico: "☾", label: "Schlaf" },
    { href: "#/koerper", ico: "◐", label: "Körper" },
    { href: "#/ziele", ico: "◎", label: "Ziele" },
    { href: "#/projekte", ico: "▤", label: "Projekte" },
    { href: "#/brainstorm", ico: "✦", label: "Brainstorm" },
    { href: "#/woche", ico: "≋", label: "Woche" }
  ];

  /** Schnellaktionen – werden von den Bereichen registriert. */
  const actions = {};
  const ACTION_ORDER = [
    ["todo", "+ To-do"], ["event", "+ Termin"], ["repeat", "+ Wiederkehrend"], ["week", "Woche: Urlaub / Schule / Krank"], ["work", "+ Arbeitszeit"], ["session", "Training starten"],
    ["run", "+ Lauf"], ["weight", "+ Gewicht"], ["photo", "+ Foto"], ["sleep", "+ Schlaf"], ["idea", "+ Idee"], ["closing", "Tagesabschluss"]
  ];

  /** Wichtigster Kontext für die Island. */
  function islandState() {
    const t = today();
    const min = nowMinutes();
    const active = store.all("sessions").find((s) => s.active);
    if (active) {
      const total = clock((Date.now() - new Date(active.startedAt || Date.now())) / 1000);
      const rest = active.lastSetAt ? clock((Date.now() - new Date(active.lastSetAt)) / 1000) : "";
      return { dot: "live", text: rest ? `Pause ${rest}` : (active.name || "Training"), small: `Gesamt ${total}`, href: `#/training/session/${active.id}` };
    }
    const upcoming = M.planEventsOn(store.all("events"), t)
      .filter((e) => !e.done && e.start && minutesOf(e.start) >= min && minutesOf(e.start) - min <= 90)
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    if (upcoming) {
      const inMin = minutesOf(upcoming.start) - min;
      return { dot: "warn", text: upcoming.title || "Termin", small: inMin <= 0 ? "jetzt" : `in ${inMin} min`, href: `#/tag/${t}` };
    }
    const entry = store.get("entries", t);
    if (min >= 21 * 60 + 15 && !M.closingDone(entry)) return { dot: "warn", text: "Tagesabschluss", small: "jetzt ausfüllen", href: `#/tagebuch/${t}` };
    const openTodos = store.all("todos").filter((x) => x.date && x.date <= t && !x.completed).length;
    const fu = followups.filter((f) => f.date <= t).length;
    const parts = [];
    if (openTodos) parts.push(`${openTodos} To-do${openTodos > 1 ? "s" : ""}`);
    if (fu) parts.push(`${fu} Follow-up${fu > 1 ? "s" : ""}`);
    const d = M.parseISO(t);
    return { dot: "", text: `${WD_SHORT[d.getUTCDay()]}, ${d.getUTCDate()}. ${MONTHS[d.getUTCMonth()]}`, small: parts.join(" · "), href: "#/" };
  }

  /** Sekunden → "m:ss" bzw. "h:mm:ss" */
  function clock(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h}:${M.pad(m)}:${M.pad(r)}` : `${m}:${M.pad(r)}`;
  }

  function updateIslandText() {
    const s = islandState();
    $("#islandDot").className = "island__dot" + (s.dot ? ` island__dot--${s.dot}` : "");
    $("#islandText").innerHTML = `${esc(s.text)}${s.small ? `<small>${esc(s.small)}</small>` : ""}`;
    $("#island").dataset.href = s.href;
  }

  function updateIsland() {
    if (document.body.classList.contains("is-locked")) return;
    updateIslandText();
    const path = "#" + parseHash().path;
    $("#islandPanel").innerHTML = `
      <h3>Bereiche</h3>
      <div class="island-nav">${NAV.map((n) => `<a href="${n.href}" class="${(n.href === "#/" ? path === "#/" || path.startsWith("#/tag/") : path.startsWith(n.href)) ? "is-active" : ""}"><span class="ico">${n.ico}</span>${n.label}</a>`).join("")}</div>
      <div class="island-sep"></div>
      <h3>Schnell</h3>
      <div class="island-actions">${ACTION_ORDER.filter(([k]) => actions[k]).map(([k, l]) => `<button type="button" data-action="${k}">${l}</button>`).join("")}</div>
      <div class="island-sep"></div>
      <div class="island-actions">
        <button type="button" data-device="push">${push.sub && window.Notification && Notification.permission === "granted" ? "🔔 Push ist an" : "🔔 Push aktivieren"}</button>
        <button type="button" data-device="pause">${pauseLabel()}</button>
        <button type="button" data-device="lock">Sperren</button>
      </div>`;
  }

  function toggleIsland(open) {
    const panel = $("#islandPanel");
    const isOpen = open ?? !panel.classList.contains("is-open");
    panel.classList.toggle("is-open", isOpen);
    $("#islandScrim").classList.toggle("is-open", isOpen);
    $("#island").setAttribute("aria-expanded", String(isOpen));
  }

  function bindIsland() {
    const island = $("#island");
    island.addEventListener("click", (e) => {
      // Tipp auf den Text springt zum Kontext, Tipp auf den Pfeil öffnet das Menü
      if (e.target.closest(".island__btn") || $("#islandPanel").classList.contains("is-open")) { toggleIsland(); return; }
      const href = island.dataset.href;
      if (href && href !== location.hash && !(href === "#/" && (location.hash === "" || location.hash === "#/"))) go(href);
      else toggleIsland();
    });
    island.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleIsland(); } });
    $("#islandScrim").addEventListener("click", () => toggleIsland(false));
    $("#islandPanel").addEventListener("click", (e) => {
      if (e.target.closest("a")) { toggleIsland(false); return; }
      const btn = e.target.closest("[data-action]");
      if (btn) { toggleIsland(false); actions[btn.dataset.action](); return; }
      const dev = e.target.closest("[data-device]");
      if (dev) {
        toggleIsland(false);
        if (dev.dataset.device === "lock") { setPin(""); lock(); }
        else if (dev.dataset.device === "pause") openPushPause();
        else $("#pushBtn").click();
      }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") toggleIsland(false); });
    $("#fab").addEventListener("click", () => toggleIsland(true));
    setInterval(updateIsland, 30000);
    // Tagesplan jede Minute neu zeichnen, damit die rote Jetzt-Linie mitwandert
    let lastMinute = new Date().getMinutes();
    setInterval(() => {
      const m = new Date().getMinutes();
      if (m === lastMinute) return;
      lastMinute = m;
      const onPlan = /^#?\/?$|^#\/tag\//.test(location.hash || "");
      const busy = document.querySelector(".sheet-form") || /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "");
      if (onPlan && !busy && !document.body.classList.contains("is-locked") && !document.hidden) render(false);
    }, 15000);
    // Während eines Trainings läuft die Island sekundengenau mit (Gesamtzeit + Pause)
    setInterval(() => {
      if (!document.body.classList.contains("is-locked") && store.all("sessions").some((s) => s.active)) updateIslandText();
    }, 1000);
  }

  /* =========================================================
     Push
     ========================================================= */

  const push = { reg: null, sub: null };
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const b64ToBytes = (b64) => {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };

  function iosHint() {
    sheet({
      title: "App auf dem iPhone installieren",
      body: `<div class="banner"><div><b>1. Zum Home-Bildschirm</b>Öffne die Seite in Safari und tippe auf <b style="display:inline">Teilen → Zum Home-Bildschirm</b>.</div></div>
        <div class="banner"><div><b>2. Push einschalten</b>Öffne „Mein Tag“ vom Home-Bildschirm, tippe auf <b style="display:inline">🔔 Push aktivieren</b> und dann auf <b style="display:inline">Erlauben</b>.</div></div>
        <p class="hint">Apple erlaubt Benachrichtigungen nur für Web-Apps, die auf dem Home-Bildschirm liegen (ab iOS 16.4).</p>`
    });
  }

  function updatePushBtn() {
    const btn = $("#pushBtn");
    const on = push.sub && Notification.permission === "granted";
    btn.hidden = false;
    btn.textContent = on ? "🔔 Push an" : "🔔 Push aktivieren";
    btn.dataset.on = on ? "1" : "";
  }

  async function initPush() {
    const btn = $("#pushBtn");
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if ("serviceWorker" in navigator) {
      try { push.reg = await navigator.serviceWorker.register("/service-worker.js"); } catch (e) { /* ignorieren */ }
    }
    if (!supported) {
      btn.onclick = isIOS() && !isStandalone() ? iosHint : () => toast("Dieser Browser unterstützt keine Push-Benachrichtigungen.", true);
      if (isIOS() && !isStandalone()) btn.hidden = false;
      return;
    }
    try { push.sub = push.reg ? await push.reg.pushManager.getSubscription() : null; } catch (e) { push.sub = null; }
    if (push.sub) api("POST", "/push/subscribe", { subscription: push.sub.toJSON(), device: navigator.platform }).catch(() => {});
    updatePushBtn();
    btn.onclick = async () => {
      if (btn.dataset.on) {
        const test = await confirmDialog("Benachrichtigungen sind aktiv. Test senden?", { confirmLabel: "Test senden", danger: false });
        if (test) testPush();
        return;
      }
      await enablePush();
    };
  }

  async function enablePush() {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { toast("Benachrichtigungen nicht erlaubt – in den Einstellungen änderbar.", true); return; }
      const { publicKey } = await api("GET", "/push/key");
      push.sub = await push.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      await api("POST", "/push/subscribe", { subscription: push.sub.toJSON(), device: navigator.platform });
      updatePushBtn();
      testPush();
    } catch (e) {
      if (!(e && e.status === 401)) toast("Push konnte nicht aktiviert werden.", true);
    }
  }

  async function testPush() {
    try {
      const r = await api("POST", "/push/test", { endpoint: push.sub && push.sub.endpoint });
      toast(r.sent ? "Test-Benachrichtigung gesendet" : "Test nicht zugestellt", !r.sent);
    } catch (e) { /* Hinweis kommt über api() */ }
  }

  /* =========================================================
     Sperre & Start
     ========================================================= */

  let started = false;
  let pollTimer = null;

  function onUnauthorized() {
    if (document.body.classList.contains("is-locked")) return;
    setPin("");
    lock("Bitte PIN erneut eingeben.");
  }

  function lock(message = "") {
    clearInterval(pollTimer);
    COLLECTIONS.forEach((c) => { state[c] = []; delete versions[c]; });
    loaded = false;
    $("#view").innerHTML = "";
    document.body.classList.add("is-locked");
    $("#pinError").textContent = message;
    $("#pinInput").value = "";
    $("#pinInput").focus();
  }

  async function unlock(pin, remember) {
    setPin(pin, remember);
    const btn = $("#pinSubmit");
    btn.disabled = true;
    btn.textContent = "Prüfe …";
    try {
      await sync();
    } catch (err) {
      setPin("");
      const card = $("#lockForm");
      $("#pinError").textContent = err.status === 401 ? "Falscher PIN" : "Server nicht erreichbar";
      $("#pinInput").value = "";
      card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
      return;
    } finally {
      btn.disabled = false;
      btn.textContent = "Entsperren";
    }
    document.body.classList.remove("is-locked");
    if (!started) {
      started = true;
      store.subscribe(() => { render(false); updateIsland(); });
      window.addEventListener("hashchange", () => render(true));
      bindIsland();
      initPush();
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { sync().catch(() => {}); loadFollowups(); } });
      window.addEventListener("online", () => sync().catch(() => {}));
    }
    render(true);
    loadFollowups();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (document.visibilityState === "visible") sync().catch(() => {});
    }, 20000);
    setInterval(loadFollowups, 5 * 60000);
  }

  function start() {
    $("#lockForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const pin = $("#pinInput").value.trim();
      if (pin) unlock(pin, $("#rememberPin").checked);
    });
    $("#pinInput").addEventListener("input", (e) => {
      e.target.value = e.target.value.replace(/\D/g, "");
      $("#pinError").textContent = "";
    });
    $("#lockBtn").addEventListener("click", () => { setPin(""); lock(); });
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", (e) => {
        if (e.data && e.data.type === "open-url") {
          const u = new URL(e.data.url, location.origin);
          if (u.hash) go(u.hash);
        }
      });
    }
    const saved = getPin();
    if (saved) unlock(saved, false); else $("#pinInput").focus();
  }

  /* =========================================================
     Gemeinsame Bausteine für die Bereiche
     ========================================================= */

  /** Kalender-Elemente eines Tages aus allen Bereichen (für Tagesansicht & Kalender). */
  function dayItems(date) {
    const items = [];
    const sessionsDone = store.all("sessions").some((s) => s.date === date && !s.active);
    const runDone = store.all("runs").some((r) => r.date === date);
    M.planEventsOn(store.all("events"), date).forEach((e) => {
      if (e.type === "absence") {
        const k = M.absenceKind(e.absence);
        items.push({ kind: "absence", time: "", end: "", title: `${k.icon} ${e.title || k.name}`, sub: e.spanDays ? `Tag ${e.spanDay} von ${e.spanDays}` : "", ref: e, date, color: k.color });
        return;
      }
      // Training/Lauf gilt automatisch als erledigt, wenn an dem Tag eins eingetragen wurde
      const autoDone = (e.type === "training" && sessionsDone) || (e.type === "run" && runDone);
      const span = e.spanDays ? `Tag ${e.spanDay}/${e.spanDays}` : "";
      items.push({ kind: e.type, time: e.spanDays && e.spanDay > 1 ? "" : e.start || "", end: e.spanDays && e.spanDay < e.spanDays ? "" : e.end || "", title: e.title, sub: [span, e.location, e.department, M.repeatLabel(e)].filter(Boolean).join(" · "), ref: e, date, done: e.done || autoDone, autoDone: autoDone && !e.done });
    });
    store.all("sessions").filter((s) => s.date === date && !s.active).forEach((s) => items.push({ kind: "session", time: "", title: s.name || "Training", sub: `${(s.exercises || []).length} Übungen`, ref: s }));
    store.all("runs").filter((r) => r.date === date).forEach((r) => items.push({ kind: "runlog", time: "", title: `Lauf ${r.distance} km`, sub: r.pace ? `${r.pace} min/km` : "", ref: r, done: true }));
    store.all("runPlan").filter((r) => r.date === date).forEach((r) => items.push({ kind: "runplan", time: "", title: r.title || "Geplanter Lauf", sub: r.targetDistance ? `Ziel ${r.targetDistance} km` : "", ref: r }));
    store.all("todos").filter((t) => t.date === date).forEach((t) => items.push({ kind: "todo", time: "", title: t.title, sub: "", ref: t, done: t.completed }));
    followups.filter((f) => f.date === date).forEach((f) => items.push({ kind: "followup", time: "", title: `${f.kind === "call" ? "Anrufen" : "Follow-up"}: ${f.company}`, sub: f.phone, ref: f }));
    return items.sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  }

  const TYPE_LABEL = { absence: "Abwesenheit", appointment: "Termin", work: "Arbeit", training: "Gym / Training", session: "Training eingetragen", run: "Lauf", runlog: "Lauf eingetragen", runplan: "Laufplan", todo: "To-do", followup: "Lead-Follow-up" };

  /** Ereignis an einem bestimmten Tag abhaken / wieder öffnen. */
  async function toggleEventDone(ev, date) {
    const base = store.get("events", ev.id);
    if (!base) return;
    const set = new Set(base.doneDates || []);
    if (set.has(date)) set.delete(date); else set.add(date);
    await store.upsert("events", { ...base, doneDates: [...set] });
  }

  function tagById(id) { return store.get("tags", id); }

  /* Push pausieren bis zu einem Datum (z. B. krank, Urlaub) */
  function pauseLabel() {
    const p = store.get("settings", "profile") || {};
    return p.pushPausedUntil && p.pushPausedUntil > today() ? `⏸ Push pausiert bis ${fmtShort(p.pushPausedUntil)}` : "⏸ Push pausieren";
  }
  function openPushPause() {
    const p = store.get("settings", "profile") || {};
    const nextMonday = M.addDays(M.weekStart(today()), 7);
    sheet({
      title: "Push-Erinnerungen pausieren",
      body: `<label class="field"><span>Erinnerungen wieder ab</span><input class="input" type="date" name="until" value="${esc(p.pushPausedUntil && p.pushPausedUntil > today() ? p.pushPausedUntil : nextMonday)}" min="${today()}"></label>
        <div class="chip-row"><button type="button" class="chip" data-until="${M.addDays(today(), 1)}">Morgen</button><button type="button" class="chip" data-until="${nextMonday}">Nächsten Montag</button></div>
        <p class="hint">Bis dahin kommen keine Erinnerungen (Tagesabschluss, Termine, To-dos). An Tagen mit „Krank“ sind Pushs ohnehin aus.</p>`,
      submitLabel: "Pausieren",
      onMount(el) { $$("[data-until]", el).forEach((b) => b.onclick = () => { $('[name="until"]', el).value = b.dataset.until; }); },
      onDelete: p.pushPausedUntil ? async () => { await store.upsert("settings", { ...p, id: "profile", pushPausedUntil: "" }); toast("Push wieder aktiv"); } : null,
      deleteLabel: "Pause beenden",
      deleteConfirm: "Push-Erinnerungen ab sofort wieder senden?",
      async onSubmit(d) {
        if (!d.until) return false;
        await store.upsert("settings", { ...p, id: "profile", pushPausedUntil: d.until });
        toast(`Push pausiert – wieder ab ${fmtShort(d.until)}`);
      }
    });
  }

  /* Fortschrittsfotos: Bilder einzeln laden (mit PIN) und im Speicher halten */
  const photoCache = new Map();
  async function photoUrl(id) {
    if (photoCache.has(id)) return photoCache.get(id);
    const p = fetch(`/api/photo/${encodeURIComponent(id)}`, { headers: { "x-pin": getPin() } })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); })
      .then((b) => URL.createObjectURL(b))
      .catch((e) => { photoCache.delete(id); throw e; });
    photoCache.set(id, p);
    return p;
  }
  /** Alle <img data-photo="id"> in root nachladen */
  function hydratePhotos(root) {
    $$("img[data-photo]", root).forEach((img) => {
      photoUrl(img.dataset.photo).then((u) => { img.src = u; img.classList.add("is-loaded"); }).catch(() => { img.alt = "Foto nicht verfügbar"; });
    });
  }

  window.App = {
    $, $$, esc, uid, today, nowMinutes, fmtLong, fmtShort, fmtDate, relDay, minutesOf, fmtMinutes, formData,
    WEEKDAYS, WD_SHORT, MONTHS, TYPE_LABEL,
    api, store, sync, toast, sheet, confirm: confirmDialog, bindSliders,
    route, go, render, actions, dayItems, toggleEventDone, tagById, iosHint, isIOS, isStandalone, clock, photoUrl, hydratePhotos,
    start
  };
})();
