/* ==========================================================
   Kalender: Termine, Arbeitszeiten, Training, To-dos, Follow-ups
   ========================================================== */

(function () {
  "use strict";
  const { esc, store, sheet, route, actions, fmtShort, fmtLong, today, dayItems, TYPE_LABEL, MONTHS } = App;
  const M = window.LifeModel;
  const S = window.AufwindSchedule;

  const EVENT_TYPES = [
    { id: "appointment", label: "Termin" },
    { id: "work", label: "Arbeit" },
    { id: "training", label: "Gym / Training" },
    { id: "run", label: "Lauf" },
    { id: "absence", label: "Abwesend" }
  ];
  const WD = M.WEEKDAY_SHORT; // Mo … So

  /* ---------- Eintrag anlegen / bearbeiten (auch wiederkehrend) ---------- */

  App.openEventSheet = function (ev = {}, occurrence = "") {
    const isNew = !ev.id;
    const base = isNew ? ev : (store.get("events", ev.id) || ev);
    const type = base.type || "appointment";
    const plans = store.all("plans");
    const e = { date: occurrence || today(), start: "", end: "", title: "", location: "", department: "", notes: "", remind: true, planId: "", repeat: "none", weekdays: [], until: "", ...base, type };
    const recurring = e.repeat && e.repeat !== "none";
    const occ = occurrence || (recurring ? "" : e.date);
    const doneHere = occ && (e.doneDates || []).includes(occ);
    const weekdays = e.weekdays && e.weekdays.length ? e.weekdays.map(Number) : [M.isoWeekday(e.date)];

    sheet({
      title: isNew ? "Neuer Eintrag" : (e.title || "Eintrag"),
      body: `
        <div class="chip-row" role="radiogroup" aria-label="Art">
          ${EVENT_TYPES.map((t) => `<label class="chip ${t.id === type ? "is-active" : ""}"><input type="radio" name="type" value="${t.id}" ${t.id === type ? "checked" : ""} hidden>${t.label}</label>`).join("")}
        </div>
        ${!isNew && occ ? `<label class="check"><input type="checkbox" name="doneHere" ${doneHere ? "checked" : ""}> Am ${esc(fmtShort(occ))} erledigt</label>` : ""}
        <div class="field" data-show="absence"><span>Art</span>
          <div class="chip-row">${M.ABSENCES.map((a) => `<label class="chip ${(e.absence || "vacation") === a.id ? "is-active" : ""}"><input type="radio" hidden name="absence" value="${a.id}" ${(e.absence || "vacation") === a.id ? "checked" : ""}>${a.icon} ${a.name}</label>`).join("")}</div>
          <p class="hint">Urlaub und Berufsschule ersetzen die Arbeit, Training bleibt. „Krank“ pausiert die ganze Routine und die Push-Erinnerungen.</p>
        </div>
        <label class="field"><span>Titel</span><input class="input" name="title" value="${esc(e.title)}" placeholder="z. B. Training A" ${isNew ? "autofocus" : ""}></label>
        <label class="field" data-show="training"><span>Trainingsplan (optional)</span>
          <select class="select" name="planId"><option value="">– frei –</option>${plans.map((p) => `<option value="${p.id}" ${p.id === e.planId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
        <div class="field-row">
          <label class="field"><span data-date-label>${recurring ? "Ab" : "Datum"}</span><input class="input" type="date" name="date" value="${esc(e.date)}" required></label>
          <label class="field" data-repeat="none"><span>Bis (mehrtägig, optional)</span><input class="input" type="date" name="endDate" value="${esc(e.endDate || "")}"></label>
        </div>
        <div class="field-row" data-hide="absence">
          <label class="field"><span>Von (Uhrzeit)</span><input class="input" type="time" name="start" value="${esc(e.start)}"></label>
          <label class="field"><span>Bis (Uhrzeit)</span><input class="input" type="time" name="end" value="${esc(e.end)}"></label>
        </div>

        <div class="field">
          <span>Wiederholen</span>
          <div class="chip-row" role="radiogroup" aria-label="Wiederholen">
            ${[["none", "Nie"], ["weekly", "Wöchentlich"], ["daily", "Täglich"]].map(([k, l]) => `<label class="chip ${e.repeat === k ? "is-active" : ""}"><input type="radio" name="repeat" value="${k}" ${e.repeat === k ? "checked" : ""} hidden>${l}</label>`).join("")}
          </div>
        </div>
        <div class="field" data-repeat="weekly">
          <span>An diesen Tagen</span>
          <div class="chip-row">${WD.map((d, i) => `<label class="chip ${weekdays.includes(i + 1) ? "is-active" : ""}"><input type="checkbox" hidden name="wd${i + 1}" ${weekdays.includes(i + 1) ? "checked" : ""}>${d}</label>`).join("")}</div>
        </div>
        <label class="field" data-repeat="weekly daily"><span>Endet am (optional)</span><input class="input" type="date" name="until" value="${esc(e.until || "")}"></label>

        <label class="field"><span data-label-location>Ort</span><input class="input" name="location" value="${esc(e.location)}"></label>
        <label class="field" data-show="work"><span>Abteilung / Einsatzbereich</span><input class="input" name="department" value="${esc(e.department)}"></label>
        <label class="check" data-show="appointment training run"><input type="checkbox" name="remind" ${e.remind !== false ? "checked" : ""}> 30 Minuten vorher erinnern (nur mit Uhrzeit)</label>
        <label class="field"><span>Notizen</span><textarea class="textarea" name="notes" rows="2">${esc(e.notes)}</textarea></label>
        ${!isNew && recurring && occ ? `<button type="button" class="btn btn--soft btn--sm" data-skip style="align-self:flex-start">Nur am ${esc(fmtShort(occ))} ausfallen lassen</button>
          <p class="hint">Änderungen gelten für alle Wiederholungen. „Löschen“ entfernt die ganze Serie.</p>` : ""}`,
      submitLabel: "Speichern",
      deleteConfirm: recurring ? "Ganze Serie löschen?" : "Eintrag löschen?",
      onMount(el, close) {
        const apply = () => {
          const t = el.querySelector('input[name="type"]:checked').value;
          const r = el.querySelector('input[name="repeat"]:checked').value;
          el.querySelectorAll("[data-show]").forEach((n) => { n.hidden = !n.dataset.show.split(" ").includes(t); });
          el.querySelectorAll("[data-hide]").forEach((n) => { n.hidden = n.dataset.hide.split(" ").includes(t); });
          el.querySelectorAll("[data-repeat]").forEach((n) => { n.hidden = !n.dataset.repeat.split(" ").includes(r); });
          el.querySelectorAll(".chip input").forEach((c) => c.parentElement.classList.toggle("is-active", c.checked));
          el.querySelector("[data-label-location]").textContent = t === "work" ? "Arbeitsort" : "Ort";
          el.querySelector("[data-date-label]").textContent = r === "none" ? "Datum" : "Ab";
        };
        el.querySelectorAll('input[name="type"], input[name="repeat"], input[name="absence"], .chip input[type="checkbox"]').forEach((r) => r.addEventListener("change", apply));
        apply();
        const skip = el.querySelector("[data-skip]");
        if (skip) skip.onclick = async () => {
          await store.upsert("events", { ...base, skipDates: [...new Set([...(base.skipDates || []), occ])] });
          App.toast(`Am ${fmtShort(occ)} ausgelassen`);
          close();
        };
      },
      async onSubmit(data, form) {
        const t = form.querySelector('input[name="type"]:checked').value;
        const repeat = form.querySelector('input[name="repeat"]:checked').value;
        const plan = plans.find((p) => p.id === data.planId);
        const absence = t === "absence" ? (form.querySelector('input[name="absence"]:checked') || {}).value || "vacation" : "";
        const title = data.title || ({ work: "Arbeit", run: "Lauf", training: plan ? plan.name : "Gym", absence: absence ? M.absenceKind(absence).name : "" }[t] || "");
        if (repeat === "none" && data.endDate && data.endDate < data.date) { App.toast("Das Enddatum liegt vor dem Startdatum.", true); return false; }
        if (!data.date) { App.toast("Bitte ein Datum wählen.", true); return false; }
        if (!title) { App.toast("Bitte einen Titel eingeben.", true); return false; }
        let wds = WD.map((_, i) => (data[`wd${i + 1}`] ? i + 1 : 0)).filter(Boolean);
        if (repeat === "weekly" && !wds.length) wds = [M.isoWeekday(data.date)];
        const doneDates = new Set(base.doneDates || []);
        if (occ && data.doneHere !== undefined) { if (data.doneHere) doneDates.add(occ); else doneDates.delete(occ); }
        await store.upsert("events", {
          ...base, type: t, title, date: data.date, start: data.start, end: data.end,
          location: data.location, department: t === "work" ? data.department : "",
          planId: t === "training" ? data.planId : "", remind: t === "work" ? false : data.remind, notes: data.notes,
          repeat, weekdays: repeat === "weekly" ? wds : [], until: repeat === "none" ? "" : data.until,
          endDate: repeat === "none" && data.endDate && data.endDate > data.date ? data.endDate : "",
          absence, ...(t === "absence" ? { start: "", end: "", remind: false } : {}),
          skipDates: base.skipDates || [], doneDates: [...doneDates]
        });
        App.toast("Gespeichert");
      },
      onDelete: isNew ? null : () => store.remove("events", base.id)
    });
  };

  /* ---------- Ganze Woche: Urlaub / Berufsschule / Krank (ein Klick) ---------- */

  App.openWeekAbsenceSheet = function (date = today()) {
    const ws = M.weekStart(date);
    const weeks = [0, 1, 2, 3].map((n) => M.addDays(ws, n * 7));
    const label = (w) => `${fmtShort(w)} – ${fmtShort(M.addDays(w, 6))}`;
    const existing = (w) => store.all("events").find((e) => e.type === "absence" && e.date === w && (e.repeat || "none") === "none");
    sheet({
      title: "Ganze Woche eintragen",
      body: `
        <div class="field"><span>Woche</span>
          <div class="chip-row">${weeks.map((w, i) => `<label class="chip ${i === 0 ? "is-active" : ""}"><input type="radio" hidden name="week" value="${w}" ${i === 0 ? "checked" : ""}>${i === 0 ? "Diese" : i === 1 ? "Nächste" : label(w)}${i < 2 ? ` · ${label(w)}` : ""}</label>`).join("")}</div>
        </div>
        <div class="absence-grid">${M.ABSENCES.map((a) => `
          <button type="button" class="absence-btn" data-absence="${a.id}" style="--c:${a.color}">
            <span class="absence-ico">${a.icon}</span><b>${a.name}</b>
            <small>${a.id === "school" ? "Mo–Fr · Arbeit entfällt" : a.id === "sick" ? "Mo–So · keine Routine, keine Pushs" : "Mo–So · Arbeit entfällt, Training bleibt"}</small>
          </button>`).join("")}</div>
        <p class="hint" data-existing></p>`,
      onMount(el, close) {
        const sync = () => {
          el.querySelectorAll(".chip input").forEach((c) => c.parentElement.classList.toggle("is-active", c.checked));
          const w = el.querySelector('input[name="week"]:checked').value;
          const ex = existing(w);
          el.querySelector("[data-existing]").textContent = ex ? `Diese Woche ist bereits als „${ex.title}“ eingetragen – ein Klick ersetzt den Eintrag.` : "";
        };
        el.querySelectorAll('input[name="week"]').forEach((r) => r.addEventListener("change", sync));
        sync();
        el.querySelectorAll("[data-absence]").forEach((b) => b.onclick = async () => {
          const w = el.querySelector('input[name="week"]:checked').value;
          const kind = M.absenceKind(b.dataset.absence);
          const ex = existing(w);
          await store.upsert("events", {
            ...(ex || {}), type: "absence", absence: kind.id, title: kind.name, date: w,
            endDate: M.addDays(w, kind.id === "school" ? 4 : 6), repeat: "none", start: "", end: "",
            remind: false, location: "", department: "", notes: "", doneDates: [], skipDates: []
          });
          App.toast(`${kind.icon} ${label(w)}: ${kind.name}`);
          close();
        });
      }
    });
  };
  actions.week = () => App.openWeekAbsenceSheet();

  actions.event = () => App.openEventSheet({ type: "appointment" });
  actions.work = () => App.openEventSheet({ type: "work", title: "Arbeit" });
  actions.repeat = () => App.openEventSheet({ type: "training", repeat: "weekly" });

  /** Klick auf ein Element aus dayItems() öffnen. */
  App.openDayItem = function (item) {
    if (["appointment", "work", "training", "run", "absence"].includes(item.kind)) return App.openEventSheet(item.ref, item.date);
    if (item.kind === "session") return App.go(`#/training/session/${item.ref.id}`);
    if (item.kind === "runlog") return App.openRunSheet && App.openRunSheet(item.ref);
    if (item.kind === "runplan") return App.openRunPlanSheet && App.openRunPlanSheet(item.ref);
    if (item.kind === "todo") return App.openTodoSheet && App.openTodoSheet(item.ref);
    if (item.kind === "followup") return window.open(item.ref.url, "_blank", "noopener");
  };

  /** Liste der Tages-Elemente (gemeinsam für Kalender & Tagesansicht). */
  const CHECKABLE = ["appointment", "work", "training", "run", "todo"];

  App.dayItemsHTML = function (items, { empty = "Nichts eingetragen." } = {}) {
    if (!items.length) return `<p class="empty">${empty}</p>`;
    return `<ul class="list timeline">${items.map((it, i) => `
      <li class="row row--click type-${it.kind} ${it.done ? "is-done" : ""}" data-item="${i}">
        ${CHECKABLE.includes(it.kind) ? `<button type="button" class="tick" role="checkbox" aria-checked="${Boolean(it.done)}" data-check="${i}" aria-label="Erledigt"></button>` : `<span class="dot"></span>`}
        <span class="time">${esc(it.time || "")}</span>
        <div class="row-main">
          <div class="row-title">${esc(it.title || TYPE_LABEL[it.kind])}</div>
          <div class="row-sub">${esc([TYPE_LABEL[it.kind], it.end ? `bis ${it.end}` : "", it.sub].filter(Boolean).join(" · "))}</div>
        </div>
      </li>`).join("")}</ul>`;
  };

  App.bindDayItems = function (root, items) {
    root.querySelectorAll("[data-item]").forEach((row) => {
      row.addEventListener("click", (e) => { if (!e.target.closest("[data-check], a")) App.openDayItem(items[Number(row.dataset.item)]); });
    });
  };

  /** Häkchen: Ereignis für diesen Tag erledigt bzw. To-do erledigt. */
  App.toggleItem = function (it) {
    if (it.kind === "todo") return App.toggleTodo(it.ref);
    if (it.autoDone) { App.toast("Automatisch erledigt – es wurde schon eingetragen."); return; }
    return App.toggleEventDone(it.ref, it.date);
  };

  App.bindDayChecks = function (root, items) {
    root.querySelectorAll("[data-check]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      App.toggleItem(items[Number(b.dataset.check)]);
    }));
  };

  /* ---------- Monatsansicht ---------- */

  function monthGrid(ym, selected) {
    const [y, m] = ym.split("-").map(Number);
    const first = `${ym}-01`;
    const start = M.addDays(first, -((M.parseISO(first).getUTCDay() + 6) % 7));
    const t = today();
    let html = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => `<div class="cal-wd">${d}</div>`).join("");
    for (let i = 0; i < 42; i++) {
      const d = M.addDays(start, i);
      const inMonth = d.slice(0, 7) === ym;
      if (i >= 35 && !inMonth && d.slice(0, 7) > ym) break;
      const items = dayItems(d);
      const kinds = [...new Set(items.map((x) => x.kind))].slice(0, 5);
      const holiday = S.holidayName(d);
      html += `<a class="cal-day ${inMonth ? "" : "is-other"} ${d === t ? "is-today" : ""} ${d === selected ? "is-selected" : ""} ${holiday ? "is-holiday" : ""}"
        href="#/kalender/${ym}?d=${d}" title="${esc(holiday)}" aria-label="${esc(fmtLong(d))}${items.length ? `, ${items.length} Einträge` : ""}">
        <span class="cal-num">${Number(d.slice(8))}</span>
        <span class="cal-dots">${kinds.map((k) => `<i class="dot type-${k}" style="background:${dotColor(k)}"></i>`).join("")}</span>
      </a>`;
    }
    return html;
  }

  function dotColor(kind) {
    if (kind === "absence") return "#2fa3c7";
    return { appointment: "var(--blue)", work: "var(--accent)", training: "var(--bad)", session: "var(--bad)", run: "var(--good)", runlog: "var(--good)", runplan: "var(--good)", followup: "var(--violet)", todo: "var(--subtle)" }[kind] || "var(--subtle)";
  }

  function currentMonth(params) {
    return params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : today().slice(0, 7);
  }
  function selectedDay(params, query) {
    const ym = currentMonth(params);
    return query.get("d") || (ym === today().slice(0, 7) ? today() : `${ym}-01`);
  }

  const calendarView = {
    render(params, query) {
      const ym = currentMonth(params);
      const selected = selectedDay(params, query);
      const [y, m] = ym.split("-").map(Number);
      const prev = m === 1 ? `${y - 1}-12` : `${y}-${M.pad(m - 1)}`;
      const next = m === 12 ? `${y + 1}-01` : `${y}-${M.pad(m + 1)}`;
      const items = dayItems(selected);
      const holiday = S.holidayName(selected);
      return `
        <header class="page-head">
          <div><p class="eyebrow">Kalender</p><h1 class="page-title">${MONTHS[m - 1]} ${y}</h1></div>
          <div class="chip-row">
            <button class="btn btn--soft btn--sm" data-week-absence>Woche als …</button>
            <button class="btn btn--soft btn--sm" data-new="work">+ Arbeitszeit</button>
            <button class="btn btn--primary btn--sm" data-new="appointment">+ Termin</button>
          </div>
        </header>
        <div class="grid" style="grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:16px" data-cal-layout>
          <section class="cal">
            <div class="cal-head">
              <a class="icon-btn" href="#/kalender/${prev}" aria-label="Vorheriger Monat">‹</a>
              <a class="btn btn--ghost btn--sm" href="#/kalender">Heute</a>
              <a class="icon-btn" href="#/kalender/${next}" aria-label="Nächster Monat">›</a>
            </div>
            <div class="cal-grid">${monthGrid(ym, selected)}</div>
          </section>
          <section class="card">
            <div class="card-head">
              <div><div class="card-kicker">${esc(App.relDay(selected))}</div><div class="card-title">${esc(fmtLong(selected))}</div>${holiday ? `<span class="pill pill--bad" style="margin-top:6px">${esc(holiday)}</span>` : ""}</div>
              <a class="btn btn--soft btn--sm" href="#/tag/${selected}">Tagesansicht</a>
            </div>
            ${App.dayItemsHTML(items)}
            <div class="chip-row" style="margin-top:14px">
              <button class="chip" data-new="appointment" data-date="${selected}">+ Termin</button>
              <button class="chip" data-new="work" data-date="${selected}">+ Arbeit</button>
              <button class="chip" data-new="training" data-date="${selected}">+ Training</button>
              <button class="chip" data-new-todo data-date="${selected}">+ To-do</button>
            </div>
            ${store.followupsError() ? `<p class="hint" style="margin-top:12px">Lead-Liste gerade nicht erreichbar.</p>` : ""}
          </section>
        </div>
        <div class="chip-row" style="margin-top:16px">
          ${["appointment", "work", "training", "run", "followup", "todo"].map((k) => `<span class="pill"><i class="dot" style="background:${dotColor(k)}"></i>${{ appointment: "Termine", work: "Arbeit", training: "Training", run: "Laufen", followup: "Lead-Follow-ups", todo: "To-dos" }[k]}</span>`).join("")}
        </div>`;
    },
    mount(root, params, query) {
      const selected = selectedDay(params, query);
      const items = dayItems(selected);
      App.bindDayItems(root, items);
      root.querySelectorAll("[data-new]").forEach((b) => b.addEventListener("click", () =>
        App.openEventSheet({ type: b.dataset.new, date: b.dataset.date || selected, title: b.dataset.new === "work" ? "Arbeit" : "" })));
      App.bindDayChecks(root, items);
      const wa = root.querySelector("[data-week-absence]");
      if (wa) wa.onclick = () => App.openWeekAbsenceSheet(selected);
      root.querySelectorAll("[data-new-todo]").forEach((b) => b.addEventListener("click", () => App.openTodoSheet({ date: b.dataset.date })));
      const layout = root.querySelector("[data-cal-layout]");
      if (layout && window.innerWidth < 860) layout.style.gridTemplateColumns = "1fr";
    }
  };

  route("/kalender", calendarView);
  route("/kalender/:month", calendarView);
})();
