/* ==========================================================
   Tagesabbildung (DayOverview) – der zentrale Startpunkt
   DayOverview { date, work, appointments, todos, workouts, running, journal }
   Führt automatisch alle Bereiche eines Tages zusammen.
   ========================================================== */

(function () {
  "use strict";
  const { esc, store, route, today, fmtLong, relDay, fmtMinutes, fmtShort, $, $$, dayItems } = App;
  const M = window.LifeModel;
  const S = window.AufwindSchedule;

  function greeting() {
    const h = M.nowInGermany().hour;
    if (h < 11) return "Guten Morgen";
    if (h < 17) return "Hallo";
    return "Guten Abend";
  }

  /** Alle Daten eines Tages zusammenführen. */
  function dayOverview(date) {
    const events = store.all("events").filter((e) => e.date === date).sort((a, b) => (a.start || "99").localeCompare(b.start || "99"));
    const isToday = date === today();
    return {
      date,
      work: events.filter((e) => e.type === "work"),
      appointments: events.filter((e) => e.type === "appointment"),
      plannedTraining: events.filter((e) => e.type === "training"),
      todos: store.all("todos").filter((t) => t.date === date || (isToday && t.date && t.date < date && !t.completed))
        .sort((a, b) => Number(a.completed) - Number(b.completed) || (a.date || "").localeCompare(b.date || "")),
      workouts: store.all("sessions").filter((s) => s.date === date),
      running: { runs: store.all("runs").filter((r) => r.date === date), plan: store.all("runPlan").filter((p) => p.date === date) },
      sleep: store.get("sleep", date),
      followups: store.followups().filter((f) => f.date === date || (isToday && f.date < date)),
      journal: store.get("entries", date),
      holiday: S.holidayName(date)
    };
  }

  function card(title, body, { link = "", linkLabel = "", action = "", actionLabel = "" } = {}) {
    return `<section class="card">
      <div class="card-head"><div class="card-title">${title}</div>
        ${link ? `<a class="section-link small" href="${link}">${linkLabel}</a>` : ""}
        ${action ? `<button class="btn btn--ghost btn--sm" data-act="${action}">${actionLabel}</button>` : ""}
      </div>${body}</section>`;
  }

  function areaTiles() {
    const data = store.data();
    const goals = store.all("goals");
    const topGoal = goals.map((g) => ({ g, p: M.goalProgress(g, data) })).sort((a, b) => b.p.progress - a.p.progress)[0];
    const overall = App.overallStrengthRank ? App.overallStrengthRank() : null;
    const sleep7 = store.all("sleep").filter((s) => s.date > M.addDays(today(), -7)).map((s) => Number(s.sleepDuration)).filter(Boolean);
    const sleepAvg = sleep7.length ? Math.round(sleep7.reduce((a, b) => a + b, 0) / sleep7.length) : 0;
    const activeProjects = store.all("projects").filter((p) => p.status === "Aktiv").length;
    const openTodos = store.all("todos").filter((t) => !t.completed).length;
    const ws = M.weekStart(today());
    const weekKm = store.all("runs").filter((r) => M.inRange(r.date, ws, M.addDays(ws, 6))).reduce((a, r) => a + (Number(r.distance) || 0), 0);
    const fb = store.get("feedback", M.addDays(ws, -7)) || store.get("feedback", ws);
    const tile = (href, ico, title, sub) => `<a class="area-tile" href="${href}"><span class="ico">${ico}</span><div><strong>${title}</strong><span>${sub}</span></div></a>`;
    return `<div class="area-tiles">
      ${tile("#/training", "◆", "Training", overall ? `Rang ${overall.label}` : "Rang freischalten")}
      ${tile("#/laufen", "➚", "Laufen", `${(Math.round(weekKm * 10) / 10).toLocaleString("de-DE")} km diese Woche`)}
      ${tile("#/schlaf", "☾", "Schlaf", sleepAvg ? `Ø ${fmtMinutes(sleepAvg)}` : "noch keine Daten")}
      ${tile("#/ziele", "◎", "Ziele", topGoal ? `${esc(topGoal.g.title).slice(0, 26)} · ${topGoal.p.progress} %` : "Ziel anlegen")}
      ${tile("#/projekte", "▤", "Projekte", `${activeProjects} aktiv`)}
      ${tile("#/koerper", "◐", "Körper", App.currentBodyweight && App.currentBodyweight() ? `${String(Math.round(App.currentBodyweight() * 10) / 10).replace(".", ",")} kg · ${store.all("photos").length} Fotos` : "Gewicht & Fotos")}
      ${tile("#/brainstorm", "✦", "Brainstorm", `${store.all("ideas").length} Ideen`)}
      ${tile("#/woche", "≋", "Wochenfeedback", fb ? "Feedback lesen" : "Woche auswerten")}
    </div>`;
  }

  const TYPE_COLOR = { appointment: "var(--blue)", work: "var(--accent)", training: "var(--bad)", session: "var(--bad)", run: "var(--good)", runplan: "var(--good)", todo: "var(--subtle)" };

  /** Tagesplan: alle abhakbaren Boxen des Tages. */
  function planItems(date) {
    const isToday = date === today();
    const items = dayItems(date).filter((it) => !["followup", "runlog", "absence"].includes(it.kind));
    const hasTrainingEvent = items.some((it) => it.kind === "training");
    const list = items.filter((it) => !(it.kind === "session" && hasTrainingEvent));
    list.forEach((it) => { if (it.kind === "session") it.done = true; });
    if (isToday) {
      store.all("todos").filter((t) => t.date && t.date < date && !t.completed)
        .forEach((t) => list.push({ kind: "todo", time: "", title: t.title, sub: `überfällig seit ${fmtShort(t.date)}`, ref: t, done: false, overdue: true }));
    }
    return list;
  }

  function duration(it) {
    const a = App.minutesOf(it.time);
    const b = App.minutesOf(it.end);
    return a !== null && b !== null && b > a ? b - a : 0;
  }
  const fmtDur = (m) => (m >= 60 ? `${Math.floor(m / 60)} Std${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);

  function boxHTML(it, i, date) {
    const dur = duration(it);
    const timed = Boolean(it.time);
    const height = timed ? Math.round(64 + Math.min(dur, 600) / 600 * 136) : null;
    const checkable = ["appointment", "work", "training", "run", "todo", "runplan"].includes(it.kind) && it.kind !== "runplan";
    const extra = !it.done && date === today() && it.kind === "training"
      ? `<button type="button" class="btn btn--soft btn--sm" data-start-training>Starten</button>`
      : !it.done && it.kind === "run" ? `<button type="button" class="btn btn--soft btn--sm" data-log-run="${date}">Eintragen</button>` : "";
    const sub = [timed ? `${it.time}${it.end ? `–${it.end}` : ""}` : "", dur ? fmtDur(dur) : "", it.sub].filter(Boolean).join(" · ");
    return `
      <div class="plan-box ${it.done ? "is-done" : ""} ${it.overdue ? "is-overdue" : ""}" data-item="${i}" style="--c:${TYPE_COLOR[it.kind] || "var(--subtle)"};${height ? `min-height:${height}px` : ""}">
        ${checkable ? `<button type="button" class="tick" role="checkbox" aria-checked="${Boolean(it.done)}" data-check="${i}" aria-label="${esc(it.title)} erledigt"></button>` : `<span class="tick" aria-checked="${Boolean(it.done)}"></span>`}
        <div class="plan-main">
          <div class="plan-title">${esc(it.title || App.TYPE_LABEL[it.kind])}</div>
          ${sub ? `<div class="plan-sub">${esc(sub)}</div>` : ""}
        </div>
        ${extra}
      </div>`;
  }

  function render(date, isHome) {
    const d = dayOverview(date);
    const isToday = date === today();
    const closing = M.closingDone(d.journal);
    const min = App.nowMinutes();
    const items = planItems(date);
    const timed = items.map((it, i) => ({ it, i })).filter((x) => x.it.time);
    const untimed = items.map((it, i) => ({ it, i })).filter((x) => !x.it.time);
    const done = items.filter((x) => x.done).length;
    const absences = dayItems(date).filter((it) => it.kind === "absence");
    const pct = items.length ? Math.round((done / items.length) * 100) : 0;
    const nowLine = isToday ? min : null;

    const timeline = timed.map(({ it, i }, n) => {
      const start = App.minutesOf(it.time);
      const showNow = nowLine !== null && start > nowLine && (n === 0 || App.minutesOf(timed[n - 1].it.time) <= nowLine);
      return `${showNow ? `<div class="now-line"><span>${M.pad(Math.floor(nowLine / 60))}:${M.pad(nowLine % 60)}</span></div>` : ""}
        <div class="plan-row"><div class="plan-time">${esc(it.time)}${it.end ? `<small>${esc(it.end)}</small>` : ""}</div>${boxHTML(it, i, date)}</div>`;
    }).join("");

    const sleepHTML = d.sleep ? `<div class="big-number" style="font-size:24px">${fmtMinutes(d.sleep.sleepDuration)}</div>
      <div class="muted small">${[d.sleep.sleepScore ? `Score ${d.sleep.sleepScore}` : "", d.sleep.deepSleep ? `Tief ${d.sleep.deepSleep} min` : ""].filter(Boolean).join(" · ")}</div>`
      : `<p class="empty">Noch nicht eingetragen.</p>`;
    const journalHTML = d.journal && (d.journal.journal || d.journal.ratings)
      ? `${d.journal.ratings ? App.ratingPills(d.journal.ratings) : `<p class="small muted" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(d.journal.journal)}</p>`}`
      : `<p class="empty">Noch kein Eintrag.</p>`;

    return `
      <header class="page-head">
        <div>
          <p class="eyebrow">${isHome ? esc(greeting()) : esc(relDay(date))}${d.holiday ? ` · ${esc(d.holiday)}` : ""}</p>
          <h1 class="hero-date">${esc(fmtLong(date))}</h1>
        </div>
        <div class="day-nav">
          <a class="icon-btn" href="#/tag/${M.addDays(date, -1)}" aria-label="Vortag">‹</a>
          ${isToday ? "" : `<a class="btn btn--soft btn--sm" href="#/">Heute</a>`}
          <a class="icon-btn" href="#/tag/${M.addDays(date, 1)}" aria-label="Folgetag">›</a>
        </div>
      </header>

      ${isToday && min >= 20 * 60 && !closing ? `
        <a class="card card--link" href="#/tagebuch/${date}?abschluss=1" style="background:var(--ink);color:#fff;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div><div class="card-kicker" style="color:rgba(255,255,255,.6)">21:15 Uhr</div><div class="card-title" style="font-size:18px">Tagesabschluss ausfüllen</div></div>
          <span class="pill" style="background:rgba(255,255,255,.14);color:#fff">Start ›</span>
        </a>` : ""}

      ${isToday && App.isIOS() && !App.isStandalone() ? `
        <div class="banner" style="margin-bottom:14px"><div><b>Als App installieren</b>Öffne die Seite in Safari und tippe auf <b style="display:inline">Teilen → Zum Home-Bildschirm</b>. Danach <b style="display:inline">🔔 Push aktivieren</b> und dann auf <b style="display:inline">Erlauben</b>.</div></div>` : ""}

      <section class="card plan">
        <div class="plan-head">
          <div><div class="card-kicker">Tagesplan</div>
            <div class="card-title">${items.length ? `${done} von ${items.length} erledigt` : "Noch nichts geplant"}</div></div>
          <div class="chip-row">
            <button class="chip" data-act="week">Woche als …</button>
            <button class="chip" data-act="routine">+ Wiederkehrend</button>
            <button class="chip" data-act="event">+ Termin</button>
            <button class="chip" data-act="todo">+ To-do</button>
          </div>
        </div>
        ${absences.map((a) => `<button type="button" class="absence-banner" data-absence-id="${esc(a.ref.id)}" style="--c:${a.color}"><b>${esc(a.title)}</b><span>${esc(a.sub || "")}${M.absenceKind(a.ref.absence).mutePush ? " · Routine pausiert · keine Push-Erinnerungen" : " · Arbeit entfällt"}</span></button>`).join("")}
        ${items.length ? `<div class="progress ${pct === 100 ? "progress--good" : ""}" style="margin:12px 0 18px"><span style="width:${pct}%"></span></div>` : ""}
        ${untimed.length ? `<div class="plan-untimed">${untimed.map(({ it, i }) => boxHTML(it, i, date)).join("")}</div>` : ""}
        ${timed.length ? `<div class="plan-timeline">${timeline}${nowLine !== null && timed.length && App.minutesOf(timed[timed.length - 1].it.time) <= nowLine ? `<div class="now-line"><span>${M.pad(Math.floor(nowLine / 60))}:${M.pad(nowLine % 60)}</span></div>` : ""}</div>` : ""}
        ${!items.length ? `<p class="empty">${absences.length ? "Heute steht nichts an – gute Besserung bzw. genieß die Zeit." : "Lege deine Routine an – z. B. Arbeit Mo–Fr 08:15–16:15 oder Gym Mo/Di/Do/Fr."}</p>` : ""}
      </section>

      <div class="grid grid-2" style="margin-top:14px">
        <section class="card"><div class="card-head"><div class="card-title">Schlaf</div><button class="btn btn--ghost btn--sm" data-act="sleep">${d.sleep ? "Bearbeiten" : "+ Eintragen"}</button></div>${sleepHTML}</section>
        <section class="card"><div class="card-head"><div class="card-title">Tagebuch ${closing ? `<span class="pill pill--good" style="margin-left:6px">Abschluss ✓</span>` : ""}</div><a class="section-link small" href="#/tagebuch/${date}">Öffnen ›</a></div>${journalHTML}</section>
      </div>

      ${d.followups.length ? `
      <details class="followups" ${fuOpen ? "open" : ""}>
        <summary><span class="dot" style="background:var(--violet)"></span> Lead-Follow-ups <span class="muted">· ${d.followups.length}${d.followups.some((f) => f.state === "overdue") ? " · davon nachholen" : ""}</span></summary>
        <ul class="list">${d.followups.map((f) => `
          <li class="row row--click" data-fu="${esc(f.url)}">
            <div class="row-main"><div class="row-title">${f.kind === "call" ? "Anrufen" : "Follow-up"}: ${esc(f.company)}</div>
            <div class="row-sub">${esc(f.phone || "")}${f.state === "overdue" ? ` · seit ${fmtShort(f.date)}` : ""}</div></div>
            ${f.phone ? `<a class="pill pill--accent" href="tel:${esc(f.phone.replace(/[^\d+]/g, "").replace(/^0/, "+49"))}" onclick="event.stopPropagation()">Anrufen</a>` : ""}
          </li>`).join("")}</ul>
      </details>` : ""}

      ${isHome ? `<section class="section"><div class="section-head"><h2 class="section-title">Bereiche</h2></div>${areaTiles()}</section>` : ""}`;
  }

  let fuOpen = false;

  function mount(root, date) {
    const det = root.querySelector("details.followups");
    if (det) det.addEventListener("toggle", () => { fuOpen = det.open; });
    const items = planItems(date);
    root.querySelectorAll(".plan-box[data-item]").forEach((box) => box.addEventListener("click", (e) => {
      if (e.target.closest("button, a")) return;
      const it = items[Number(box.dataset.item)];
      if (it) App.openDayItem(it);
    }));
    App.bindDayChecks(root, items);
    $$("[data-absence-id]", root).forEach((b) => b.onclick = () => App.openEventSheet(store.get("events", b.dataset.absenceId), date));
    $$("[data-start-training]", root).forEach((b) => b.onclick = (e) => { e.stopPropagation(); App.actions.session(); });
    $$("[data-log-run]", root).forEach((b) => b.onclick = (e) => { e.stopPropagation(); App.openRunSheet({ date: b.dataset.logRun }); });
    $$("[data-fu]", root).forEach((r) => r.onclick = () => window.open(r.dataset.fu, "_blank", "noopener"));
    $$("[data-act]", root).forEach((b) => b.onclick = () => {
      const a = b.dataset.act;
      if (a === "week") return App.openWeekAbsenceSheet(date);
      if (a === "routine") return App.openEventSheet({ type: "training", date, repeat: "weekly" });
      if (a === "event") return App.openEventSheet({ type: "appointment", date });
      if (a === "todo") return App.openTodoSheet({ date });
      if (a === "sleep") return App.openSleepSheet(store.get("sleep", date) || { date });
    });
  }

  route("/", { render: () => render(today(), true), mount: (root) => mount(root, today()) });
  route("/tag/:date", {
    render: (p) => render(M.parseISO(p.date) ? p.date : today(), false),
    mount: (root, p) => mount(root, M.parseISO(p.date) ? p.date : today())
  });
})();
