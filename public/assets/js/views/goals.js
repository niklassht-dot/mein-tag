/* ==========================================================
   Langfristige Ziele + Aktuelle Projekte
   Goal    { id, title, currentValue, targetValue, unit, deadline, link }
   Project { id, title, status, progress, notes }
   Ziele können mit Training (Übung), Projekten oder Läufen verknüpft
   werden – der aktuelle Wert kommt dann automatisch aus diesen Daten.
   ========================================================== */

(function () {
  "use strict";
  const { esc, store, sheet, route, fmtDate, today, $, $$ } = App;
  const M = window.LifeModel;

  const PROJECT_STATUS = ["Idee", "Aktiv", "Pausiert", "Abgeschlossen"];
  const LINKS = [
    { id: "manual", label: "Selbst eintragen" },
    { id: "exercise", label: "Training (Übung)" },
    { id: "projects", label: "Abgeschlossene Projekte" },
    { id: "runs", label: "Gelaufene Kilometer" }
  ];

  const num = (n) => (Math.round(Number(n) * 10) / 10).toLocaleString("de-DE");

  function goalLine(g, gp) {
    const unit = g.unit ? ` ${esc(g.unit)}` : "";
    if (g.link && g.link.type === "exercise") {
      const info = M.exerciseGoalInfo(g, store.data());
      let hint;
      if (!info.found) hint = `Noch kein Satz „${esc(g.link.exercise || "")}“ im Training gefunden.`;
      else if (info.best) {
        const b = info.best;
        const set = b.weight ? `+${num(b.weight)} kg × ${b.reps}` : `${b.reps} Wdh. ohne Zusatzgewicht`;
        hint = `Bester Satz: ${set}` + (b.reps !== info.minReps ? ` ≈ +${num(b.equiv)} kg × ${info.minReps}` : "");
      }
      return `+${num(gp.current)}${unit} / +${num(gp.target)}${unit} für ${esc(g.link.reps || 1)} Wiederholungen` +
        (hint ? `<br><span style="opacity:.8">${hint}</span>` : "");
    }
    return `${num(gp.current)} / ${num(gp.target)}${unit}`;
  }

  function daysLeft(deadline) {
    if (!deadline) return "";
    const d = Math.round((M.parseISO(deadline) - M.parseISO(today())) / 86400000);
    if (d < 0) return `seit ${-d} Tagen überfällig`;
    if (d === 0) return "heute fällig";
    return `noch ${d} Tage`;
  }

  App.goalCardHTML = function (g) {
    const gp = M.goalProgress(g, store.data());
    return `
      <button type="button" class="card card--link" data-goal="${g.id}" style="text-align:left;width:100%">
        <div class="card-head" style="margin-bottom:6px">
          <div class="card-title">${esc(g.title)}</div>
          <span class="pill ${gp.progress >= 100 ? "pill--good" : "pill--accent"}">${gp.progress} %</span>
        </div>
        <div class="muted small" style="margin-bottom:10px">${goalLine(g, gp)}</div>
        <div class="progress ${gp.progress >= 100 ? "progress--good" : ""}"><span style="width:${gp.progress}%"></span></div>
        <div class="progress-meta"><span>${g.deadline ? `bis ${esc(fmtDate(g.deadline))}` : ""}</span><span>${esc(daysLeft(g.deadline))}</span></div>
      </button>`;
  };

  App.openGoalSheet = function (g = {}) {
    const isNew = !g.id;
    const link = g.link || { type: "manual" };
    const exercises = M.knownExercises(store.all("sessions"), store.all("plans"));
    sheet({
      title: isNew ? "Neues Ziel" : "Ziel bearbeiten",
      body: `
        <label class="field"><span>Ziel</span><input class="input" name="title" value="${esc(g.title || "")}" placeholder="z. B. 12 Projekte bis Jahresende" autofocus></label>
        <label class="field"><span>Fortschritt kommt aus</span>
          <select class="select" name="linkType">${LINKS.map((l) => `<option value="${l.id}" ${l.id === link.type ? "selected" : ""}>${l.label}</option>`).join("")}</select></label>
        <div class="field-row" data-link="exercise">
          <label class="field"><span>Übung</span><input class="input" name="exercise" list="goalEx" value="${esc(link.exercise || "")}" placeholder="z. B. Dips"></label>
          <label class="field"><span>Wiederholungen</span><input class="input" name="reps" type="number" min="1" data-number value="${esc(link.reps || 8)}"></label>
          <datalist id="goalEx">${exercises.map((e) => `<option value="${esc(e.name)}">`).join("")}</datalist>
        </div>
        <label class="field" data-link="runs"><span>Kilometer zählen ab</span><input class="input" type="date" name="since" value="${esc(link.since || today().slice(0, 4) + "-01-01")}"></label>
        <div class="field-row field-row--3">
          <label class="field" data-link="manual"><span>Aktuell</span><input class="input" name="currentValue" inputmode="decimal" data-number value="${esc(g.currentValue ?? 0)}"></label>
          <label class="field"><span>Ziel</span><input class="input" name="targetValue" inputmode="decimal" data-number value="${esc(g.targetValue ?? "")}" required></label>
          <label class="field"><span>Einheit</span><input class="input" name="unit" value="${esc(g.unit || "")}" placeholder="kg, km, Projekte …"></label>
        </div>
        <label class="field"><span>Deadline</span><input class="input" type="date" name="deadline" value="${esc(g.deadline || "")}"></label>`,
      onMount(el) {
        const sel = $('[name="linkType"]', el);
        const unit = $('[name="unit"]', el);
        const apply = () => {
          $$("[data-link]", el).forEach((n) => { n.hidden = n.dataset.link !== sel.value; });
          if (!unit.value || ["kg", "km", "Projekte"].includes(unit.value)) {
            unit.value = { exercise: "kg", runs: "km", projects: "Projekte" }[sel.value] || unit.value;
          }
        };
        sel.addEventListener("change", apply);
        apply();
      },
      async onSubmit(d) {
        if (!d.title || !(Number(d.targetValue) > 0)) { App.toast("Bitte Ziel und Zielwert angeben.", true); return false; }
        const newLink = { type: d.linkType };
        if (d.linkType === "exercise") { newLink.exercise = d.exercise; newLink.reps = Number(d.reps) || 1; }
        if (d.linkType === "runs") newLink.since = d.since;
        await store.upsert("goals", {
          ...g, title: d.title, link: newLink, currentValue: Number(d.currentValue) || 0,
          targetValue: Number(d.targetValue), unit: d.unit, deadline: d.deadline
        });
      },
      onDelete: isNew ? null : () => store.remove("goals", g.id)
    });
  };

  App.openProjectSheet = function (p = {}) {
    const isNew = !p.id;
    sheet({
      title: isNew ? "Neues Projekt" : p.title,
      body: `
        <label class="field"><span>Projekt</span><input class="input" name="title" value="${esc(p.title || "")}" autofocus></label>
        <label class="field"><span>Status</span>
          <select class="select" name="status">${PROJECT_STATUS.map((s) => `<option ${s === (p.status || "Aktiv") ? "selected" : ""}>${s}</option>`).join("")}</select></label>
        <div class="field"><span>Fortschritt</span>
          <div class="slider" style="grid-template-columns:1fr 46px;padding:0"><input type="range" min="0" max="100" step="5" name="progress" value="${esc(p.progress ?? 0)}"><output>${esc(p.progress ?? 0)}</output></div></div>
        <label class="field"><span>Aktueller Stand / Notizen</span><textarea class="textarea" name="notes" rows="6">${esc(p.notes || "")}</textarea></label>`,
      onMount(el) { App.bindSliders(el); },
      async onSubmit(d) {
        if (!d.title) return false;
        await store.upsert("projects", { ...p, title: d.title, status: d.status, progress: Number(d.progress) || 0, notes: d.notes });
      },
      onDelete: isNew ? null : () => store.remove("projects", p.id)
    });
  };

  App.projectCardHTML = function (p) {
    const pillCls = { Aktiv: "pill--accent", Abgeschlossen: "pill--good", Pausiert: "pill--warn" }[p.status] || "";
    return `
      <button type="button" class="card card--link" data-project="${p.id}" style="text-align:left;width:100%">
        <div class="card-head" style="margin-bottom:8px"><div class="card-title">${esc(p.title)}</div><span class="pill ${pillCls}">${esc(p.status || "Aktiv")}</span></div>
        <div class="progress ${p.status === "Abgeschlossen" ? "progress--good" : ""}"><span style="width:${Number(p.progress) || 0}%"></span></div>
        <div class="progress-meta"><span>${Number(p.progress) || 0} %</span></div>
        ${p.notes ? `<p class="muted small" style="margin-top:8px;white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${esc(p.notes)}</p>` : ""}
      </button>`;
  };

  function bindCards(root) {
    $$("[data-goal]", root).forEach((b) => b.onclick = () => App.openGoalSheet(store.get("goals", b.dataset.goal)));
    $$("[data-project]", root).forEach((b) => b.onclick = () => App.openProjectSheet(store.get("projects", b.dataset.project)));
  }
  App.bindGoalProjectCards = bindCards;

  route("/ziele", {
    render() {
      const goals = store.all("goals").sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
      return `
        <header class="page-head">
          <div><p class="eyebrow">Langfristig</p><h1 class="page-title">Ziele</h1></div>
          <button class="btn btn--primary btn--sm" data-add>+ Ziel</button>
        </header>
        <div class="grid grid-2">${goals.map(App.goalCardHTML).join("") || `<div class="card"><p class="empty">Noch keine Ziele. Ziele können automatisch aus Training, Projekten oder Läufen mitwachsen.</p></div>`}</div>
        <section class="section">
          <div class="section-head"><h2 class="section-title">Projekte</h2><a class="section-link" href="#/projekte">Alle ›</a></div>
          <div class="grid grid-3">${store.all("projects").filter((p) => p.status !== "Abgeschlossen").map(App.projectCardHTML).join("") || `<p class="empty">Keine aktiven Projekte.</p>`}</div>
        </section>`;
    },
    mount(root) { $("[data-add]", root).onclick = () => App.openGoalSheet(); bindCards(root); }
  });

  route("/projekte", {
    render() {
      const order = (p) => PROJECT_STATUS.indexOf(p.status) === 1 ? 0 : PROJECT_STATUS.indexOf(p.status) + 1;
      const projects = store.all("projects").sort((a, b) => order(a) - order(b) || a.title.localeCompare(b.title, "de"));
      return `
        <header class="page-head">
          <div><p class="eyebrow">Aktuell</p><h1 class="page-title">Projekte</h1></div>
          <button class="btn btn--primary btn--sm" data-add>+ Projekt</button>
        </header>
        <div class="grid grid-3">${projects.map(App.projectCardHTML).join("") || `<div class="card"><p class="empty">Noch keine Projekte.</p></div>`}</div>`;
    },
    mount(root) { $("[data-add]", root).onclick = () => App.openProjectSheet(); bindCards(root); }
  });
})();
