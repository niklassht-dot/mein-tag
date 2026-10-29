/* ==========================================================
   Schlaftracking + Laufen (inkl. eigenem Laufplan)
   SleepEntry { date, sleepDuration, sleepScore, deepSleep, remSleep, awakeTime }  (Minuten)
   Run        { date, distance, duration, pace, source, stravaUrl }
   RunPlan    { date, title, targetDistance, notes }
   ========================================================== */

(function () {
  "use strict";
  const { esc, store, sheet, route, actions, today, fmtShort, fmtLong, relDay, fmtMinutes, $, $$ } = App;
  const M = window.LifeModel;

  /* =================== Schlaf =================== */

  App.openSleepSheet = function (s = {}) {
    const isNew = !s.id;
    const dur = Number(s.sleepDuration) || 0;
    sheet({
      title: isNew ? "Schlaf eintragen" : "Schlaf bearbeiten",
      body: `
        <label class="field"><span>Nacht bis (Datum am Morgen)</span><input class="input" type="date" name="date" value="${esc(s.date || today())}"></label>
        <div class="field-row">
          <label class="field"><span>Schlafdauer – Stunden</span><input class="input" type="number" min="0" max="24" inputmode="numeric" name="h" data-number value="${dur ? Math.floor(dur / 60) : ""}" autofocus></label>
          <label class="field"><span>Minuten</span><input class="input" type="number" min="0" max="59" inputmode="numeric" name="m" data-number value="${dur ? dur % 60 : ""}"></label>
        </div>
        <label class="field"><span>Schlafwert (Zepp Score)</span><input class="input" type="number" min="0" max="100" inputmode="numeric" name="sleepScore" data-number value="${esc(s.sleepScore ?? "")}"></label>
        <div class="field-row field-row--3">
          <label class="field"><span>Tiefschlaf (min)</span><input class="input" type="number" min="0" inputmode="numeric" name="deepSleep" data-number value="${esc(s.deepSleep ?? "")}"></label>
          <label class="field"><span>REM (min)</span><input class="input" type="number" min="0" inputmode="numeric" name="remSleep" data-number value="${esc(s.remSleep ?? "")}"></label>
          <label class="field"><span>Wach (min)</span><input class="input" type="number" min="0" inputmode="numeric" name="awakeTime" data-number value="${esc(s.awakeTime ?? "")}"></label>
        </div>`,
      async onSubmit(d) {
        if (!d.date) return false;
        const minutes = (Number(d.h) || 0) * 60 + (Number(d.m) || 0);
        if (!minutes) { App.toast("Bitte die Schlafdauer eingeben.", true); return false; }
        if (!isNew && s.id !== d.date) await store.remove("sleep", s.id);
        await store.upsert("sleep", {
          id: d.date, date: d.date, sleepDuration: minutes, sleepScore: d.sleepScore === "" ? "" : Number(d.sleepScore),
          deepSleep: d.deepSleep === "" ? "" : Number(d.deepSleep), remSleep: d.remSleep === "" ? "" : Number(d.remSleep),
          awakeTime: d.awakeTime === "" ? "" : Number(d.awakeTime), source: s.source || "manuell"
        });
      },
      onDelete: isNew ? null : () => store.remove("sleep", s.id)
    });
  };
  actions.sleep = () => App.openSleepSheet(store.get("sleep", today()) || {});

  /** Zepp-Export (SLEEP_*.csv) einlesen: date, deepSleepTime, shallowSleepTime, wakeTime, REMTime … */
  function parseZeppCSV(text) {
    const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
    if (lines.length < 2) return [];
    const head = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const col = (...names) => head.findIndex((h) => names.includes(h));
    const iDate = col("date");
    const iDeep = col("deepsleeptime", "deepsleep");
    const iLight = col("shallowsleeptime", "lightsleeptime", "shallowsleep");
    const iRem = col("remtime", "rem");
    const iWake = col("waketime", "awaketime");
    const iScore = col("sleepscore", "score");
    if (iDate < 0 || (iDeep < 0 && iLight < 0)) return [];
    return lines.slice(1).map((l) => {
      const c = l.split(",");
      const n = (i) => (i >= 0 ? Number(c[i]) || 0 : 0);
      const deep = n(iDeep), light = n(iLight), rem = n(iRem);
      return {
        date: String(c[iDate] || "").trim().slice(0, 10),
        sleepDuration: deep + light + rem,
        deepSleep: deep, remSleep: iRem >= 0 ? rem : "", awakeTime: iWake >= 0 ? n(iWake) : "",
        sleepScore: iScore >= 0 ? n(iScore) : ""
      };
    }).filter((r) => M.parseISO(r.date) && r.sleepDuration > 0);
  }

  async function importZepp(file) {
    const rows = parseZeppCSV(await file.text());
    if (!rows.length) { App.toast("Keine Schlafdaten erkannt (Zepp-Datei SLEEP_….csv).", true); return; }
    const from = M.addDays(today(), -90);
    const recent = rows.filter((r) => r.date >= from);
    let count = 0;
    App.toast(`Importiere ${recent.length} Nächte …`);
    for (const r of recent) {
      const existing = store.get("sleep", r.date) || {};
      await store.upsert("sleep", { ...existing, ...r, id: r.date, sleepScore: r.sleepScore === "" ? existing.sleepScore ?? "" : r.sleepScore, source: "zepp" }).catch(() => {});
      count++;
    }
    App.toast(`${count} Nächte aus Zepp übernommen`);
  }

  const avg = (list) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null);

  route("/schlaf", {
    render() {
      const all = store.all("sleep").sort((a, b) => b.date.localeCompare(a.date));
      const last7 = all.filter((s) => s.date > M.addDays(today(), -7));
      const nums = (k) => last7.map((s) => Number(s[k])).filter((x) => x > 0);
      const days = Array.from({ length: 14 }, (_, i) => M.addDays(today(), i - 13));
      const maxDur = Math.max(480, ...all.map((s) => Number(s.sleepDuration) || 0));
      return `
        <header class="page-head">
          <div><p class="eyebrow">Schlaftracking</p><h1 class="page-title">Schlaf</h1></div>
          <div class="chip-row">
            <label class="btn btn--soft btn--sm" style="cursor:pointer">Zepp-Daten importieren<input type="file" accept=".csv,text/csv" data-import hidden></label>
            <button class="btn btn--primary btn--sm" data-add>+ Nacht</button>
          </div>
        </header>
        <div class="grid grid-4">
          <div class="card"><div class="card-kicker">Ø Dauer (7 Tage)</div><div class="big-number" style="font-size:26px">${avg(nums("sleepDuration")) ? fmtMinutes(avg(nums("sleepDuration"))) : "–"}</div></div>
          <div class="card"><div class="card-kicker">Ø Schlafwert</div><div class="big-number">${avg(nums("sleepScore")) ?? "–"}</div></div>
          <div class="card"><div class="card-kicker">Ø Tiefschlaf</div><div class="big-number">${avg(nums("deepSleep")) ?? "–"}<small>min</small></div></div>
          <div class="card"><div class="card-kicker">Ø REM</div><div class="big-number">${avg(nums("remSleep")) ?? "–"}<small>min</small></div></div>
        </div>
        <section class="section">
          <div class="section-head"><h2 class="section-title">Letzte 14 Nächte</h2></div>
          <div class="card"><div class="bar-chart">${days.map((d) => {
            const s = store.get("sleep", d);
            const v = s ? Number(s.sleepDuration) || 0 : 0;
            return `<div class="bar" title="${esc(fmtLong(d))}${v ? ": " + fmtMinutes(v) : ""}"><i style="height:${v ? Math.max(4, (v / maxDur) * 100) : 0}%"></i><span>${App.WD_SHORT[M.parseISO(d).getUTCDay()]}</span></div>`;
          }).join("")}</div></div>
        </section>
        <section class="section">
          <div class="card"><ul class="list">${all.slice(0, 30).map((s) => `
            <li class="row row--click" data-sleep="${s.id}">
              <div class="row-main"><div class="row-title">${esc(fmtLong(s.date))}</div>
              <div class="row-sub">${[s.deepSleep ? `Tief ${s.deepSleep} min` : "", s.remSleep ? `REM ${s.remSleep} min` : "", s.awakeTime ? `wach ${s.awakeTime} min` : "", s.source === "zepp" ? "Zepp" : ""].filter(Boolean).join(" · ")}</div></div>
              ${s.sleepScore ? `<span class="pill pill--accent">${s.sleepScore}</span>` : ""}
              <span class="row-meta">${fmtMinutes(s.sleepDuration)}</span>
            </li>`).join("") || `<li class="empty">Noch keine Nächte eingetragen.</li>`}</ul></div>
          <p class="hint" style="margin-top:10px">Zepp: In der Zepp-App unter Profil → Einstellungen → Konto → Daten exportieren. Die Datei SLEEP_….csv hier importieren (letzte 90 Tage). Der Schlafwert ist im Export nicht enthalten und kann ergänzt werden.</p>
        </section>`;
    },
    mount(root) {
      $("[data-add]", root).onclick = actions.sleep;
      $("[data-import]", root).onchange = (e) => { const f = e.target.files[0]; if (f) importZepp(f); e.target.value = ""; };
      $$("[data-sleep]", root).forEach((r) => r.onclick = () => App.openSleepSheet(store.get("sleep", r.dataset.sleep)));
    }
  });

  /* =================== Laufen =================== */

  App.openRunSheet = function (r = {}) {
    const isNew = !r.id;
    let extra = {};
    sheet({
      title: isNew ? "Lauf eintragen" : "Lauf bearbeiten",
      body: `
        <label class="field"><span>Strava-Link (optional)</span><input class="input" type="url" name="stravaUrl" value="${esc(r.stravaUrl || "")}" placeholder="Link einfügen – Werte werden übernommen" ${!r.id ? "autofocus" : ""}></label>
        <p class="hint" data-strava-status></p>
        <div class="field-row">
          <label class="field"><span>Datum</span><input class="input" type="date" name="date" value="${esc(r.date || today())}"></label>
          <label class="field"><span>Distanz (km)</span><input class="input" inputmode="decimal" name="distance" value="${esc(r.distance ?? "")}"></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Dauer (h:mm:ss)</span><input class="input" name="duration" value="${r.duration ? esc(M.formatDuration(r.duration)) : ""}" placeholder="0:32:10"></label>
          <label class="field"><span>Pace</span><input class="input" name="pace" value="${esc(r.pace || "")}" readonly placeholder="automatisch"></label>
        </div>
`,
      onMount(el) {
        const upd = () => {
          const d = Number(String($('[name="distance"]', el).value).replace(",", "."));
          const s = M.parseDuration($('[name="duration"]', el).value);
          $('[name="pace"]', el).value = M.pace(d, s) ? `${M.pace(d, s)} min/km` : "";
        };
        el.addEventListener("input", upd);
        upd();

        // Strava-Link → Werte automatisch übernehmen
        const link = $('[name="stravaUrl"]', el);
        const status = $("[data-strava-status]", el);
        let last = "";
        let timer;
        const lookup = async () => {
          const url = link.value.trim();
          if (!url || url === last || !/strava/i.test(url)) return;
          last = url;
          status.textContent = "Lese Werte von Strava …";
          try {
            const res = await App.api("POST", "/strava/activity", { url });
            const run = res.run;
            if (run.date) $('[name="date"]', el).value = run.date;
            if (run.distance) $('[name="distance"]', el).value = String(run.distance).replace(".", ",");
            if (run.duration) $('[name="duration"]', el).value = M.formatDuration(run.duration);
            link.value = run.stravaUrl || url;
            extra = { stravaId: run.stravaId, name: run.name || "", elevation: run.elevation ?? "", avgHeartrate: run.avgHeartrate ?? "" };
            upd();
            status.innerHTML = `✓ Übernommen${run.name ? `: <b>${esc(run.name)}</b>` : ""}${run.partial ? " – bitte fehlende Werte ergänzen" : ""}`;
          } catch (err) {
            status.innerHTML = `⚠︎ ${esc((err.data && err.data.message) || "Werte konnten nicht gelesen werden.")}`;
          }
        };
        link.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(lookup, 500); });
        link.addEventListener("paste", () => setTimeout(lookup, 50));
      },
      async onSubmit(d) {
        const distance = Number(String(d.distance).replace(",", "."));
        const duration = M.parseDuration(d.duration);
        if (!(distance > 0)) { App.toast("Bitte die Distanz eingeben.", true); return false; }
        await store.upsert("runs", {
          ...r, ...extra, date: d.date, distance, duration, pace: M.pace(distance, duration),
          source: d.stravaUrl ? "strava" : "manuell", stravaUrl: d.stravaUrl
        });
        App.toast("Lauf gespeichert");
      },
      onDelete: isNew ? null : () => store.remove("runs", r.id)
    });
  };
  actions.run = () => App.openRunSheet();

  App.openRunPlanSheet = function (p = {}) {
    const isNew = !p.id;
    sheet({
      title: isNew ? "Lauf planen" : "Geplanter Lauf",
      body: `
        <label class="field"><span>Titel</span><input class="input" name="title" value="${esc(p.title || "")}" placeholder="z. B. Lockerer Dauerlauf" autofocus></label>
        <div class="field-row">
          <label class="field"><span>Datum</span><input class="input" type="date" name="date" value="${esc(p.date || today())}"></label>
          <label class="field"><span>Ziel (km)</span><input class="input" inputmode="decimal" name="targetDistance" value="${esc(p.targetDistance ?? "")}"></label>
        </div>
        <label class="field"><span>Notizen</span><textarea class="textarea" name="notes" rows="2">${esc(p.notes || "")}</textarea></label>`,
      async onSubmit(d) {
        await store.upsert("runPlan", { ...p, title: d.title || "Lauf", date: d.date, targetDistance: Number(String(d.targetDistance).replace(",", ".")) || "", notes: d.notes });
      },
      onDelete: isNew ? null : () => store.remove("runPlan", p.id)
    });
  };

  async function initStravaCard(root) {
    const title = $("[data-strava-title]", root);
    const actionsEl = $("[data-strava-actions]", root);
    const hint = $("[data-strava-hint]", root);
    if (!title) return;
    let st;
    try { st = await App.api("GET", "/strava/status"); } catch (e) { title.textContent = "Status nicht abrufbar"; return; }
    if (st.connected) {
      title.textContent = `Verbunden${st.athlete ? ` · ${st.athlete}` : ""}`;
      actionsEl.innerHTML = `<button class="btn btn--primary btn--sm" data-import>Neue Läufe holen</button><button class="btn btn--ghost btn--sm" data-disconnect>Trennen</button>`;
      hint.textContent = "Strava-Link in einen Lauf einfügen – Datum, Distanz, Zeit und Pace werden übernommen. Oder die Läufe der letzten 30 Tage holen.";
      $("[data-import]", root).onclick = async (e) => {
        e.currentTarget.disabled = true;
        try {
          const r = await App.api("POST", "/strava/import");
          await App.sync();
          App.toast(r.imported ? `${r.imported} Lauf${r.imported > 1 ? "e" : ""} übernommen` : "Keine neuen Läufe");
        } catch (err) { App.toast((err.data && err.data.message) || "Import fehlgeschlagen", true); }
        App.render();
      };
      $("[data-disconnect]", root).onclick = async () => {
        if (await App.confirm("Strava-Verbindung trennen?", { confirmLabel: "Trennen" })) { await App.api("POST", "/strava/disconnect"); App.render(); }
      };
    } else if (st.configured) {
      title.textContent = "Nicht verbunden";
      actionsEl.innerHTML = `<button class="btn btn--primary btn--sm" data-connect>Strava verbinden</button>`;
      const domain = location.host;
      hint.innerHTML = `Wichtig: In deiner Strava-App (strava.com/settings/api) muss bei <b>Authorization Callback Domain</b> genau
        <code class="code-chip" data-copy-domain title="Kopieren">${esc(domain)}</code> stehen – ohne https:// und ohne Schrägstrich.
        Danach einmal verbinden, ab dann werden Werte aus jedem Strava-Link übernommen.`;
      $("[data-copy-domain]", root).onclick = async () => {
        try { await navigator.clipboard.writeText(domain); App.toast("Domain kopiert"); } catch (e) { /* ignorieren */ }
      };
      $("[data-connect]", root).onclick = async () => {
        try { const r = await App.api("POST", "/strava/connect", { origin: location.origin }); location.href = r.url; }
        catch (err) { App.toast((err.data && err.data.message) || "Verbindung nicht möglich", true); }
      };
    } else {
      title.textContent = "Noch nicht eingerichtet";
      hint.innerHTML = "Öffentliche Aktivitäten werden aus dem Link ausgelesen. Für private Läufe und den Import einmal die Strava-API einrichten – Anleitung in der README (Abschnitt „Strava“).";
    }
  }

  route("/laufen", {
    render() {
      const runs = store.all("runs").sort((a, b) => b.date.localeCompare(a.date));
      const endurance = M.enduranceProgress(runs);
      const er = M.enduranceRank(runs);
      const ws = M.weekStart(today());
      const weekKm = runs.filter((r) => M.inRange(r.date, ws, M.addDays(ws, 6))).reduce((a, r) => a + (Number(r.distance) || 0), 0);
      const weeks = Array.from({ length: 8 }, (_, i) => M.addDays(ws, (i - 7) * 7));
      const weekly = weeks.map((w) => runs.filter((r) => M.inRange(r.date, w, M.addDays(w, 6))).reduce((a, r) => a + (Number(r.distance) || 0), 0));
      const maxKm = Math.max(5, ...weekly);
      const plan = store.all("runPlan").filter((p) => p.date >= M.addDays(today(), -7)).sort((a, b) => a.date.localeCompare(b.date));
      const doneOn = (date) => runs.some((r) => r.date === date);
      return `
        <header class="page-head">
          <div><p class="eyebrow">Ausdauer</p><h1 class="page-title">Laufen</h1></div>
          <div class="chip-row">
            <button class="btn btn--soft btn--sm" data-plan>+ Laufplan</button>
            <button class="btn btn--primary btn--sm" data-add>+ Lauf</button>
          </div>
        </header>
        <div class="grid grid-3">
          <div class="card">
            <div class="card-kicker">Ausdauer-Rang</div>
            ${er ? `<div style="display:flex;align-items:center;gap:10px;margin-top:4px">${App.rankEmblem(er.rank, 40)}<div><div class="big-number" style="font-size:24px">${esc(er.rank.label)}</div>
              <div class="muted small">5 km ≈ ${M.formatDuration(er.est5k, false)}</div></div></div>
              ${er.rank.next ? `<div class="progress" style="margin-top:10px"><span style="width:${Math.round(er.rank.progress * 100)}%;background:${er.rank.color}"></span></div><div class="progress-meta"><span>${esc(er.rank.name)}</span><span>${esc(er.rank.next.name)} ab ${M.formatDuration(er.nextTime, false)}</span></div>` : ""}`
              : (() => {
                const missing = M.runsMissingTime(runs);
                return missing.length
                  ? `<p class="small" style="margin-top:6px">Für den Rang fehlt die <b>Laufzeit</b> bei ${missing.length === 1 ? "deinem Lauf" : `${missing.length} Läufen`}.</p>
                     <button class="btn btn--soft btn--sm" style="margin-top:8px" data-fix-run="${esc(missing[0].id)}">Zeit eintragen (${esc(fmtShort(missing[0].date))}, ${(Math.round(Number(String(missing[0].distance).replace(",", ".")) * 10) / 10).toLocaleString("de-DE")} km)</button>`
                  : `<p class="muted small" style="margin-top:6px">Rang ab dem ersten Lauf über ${M.RANK_MIN_KM} km mit Zeit (geschätzte 5-km-Zeit, verglichen mit Männern).</p>`;
              })()}
          </div>
          <div class="card"><div class="card-kicker">Diese Woche</div><div class="big-number">${(Math.round(weekKm * 10) / 10).toLocaleString("de-DE")}<small>km</small></div></div>
          <div class="card"><div class="card-kicker">Gesamt</div><div class="big-number">${endurance.km.toLocaleString("de-DE")}<small>km · ${endurance.runs} Läufe</small></div></div>
        </div>
        <section class="card" style="margin-top:14px" data-strava-card>
          <div class="card-head" style="margin-bottom:0"><div><div class="card-kicker">Strava</div><div class="card-title" data-strava-title>Verbindung wird geprüft …</div></div>
            <div class="chip-row" data-strava-actions></div></div>
          <p class="hint" data-strava-hint style="margin-top:8px"></p>
        </section>

        <section class="section">
          <div class="section-head"><h2 class="section-title">Laufplan</h2></div>
          <div class="card"><ul class="list">${plan.map((p) => `
            <li class="row row--click" data-runplan="${p.id}">
              <span class="tick" role="img" aria-label="${doneOn(p.date) ? "gelaufen" : "offen"}" aria-checked="${doneOn(p.date)}"></span>
              <div class="row-main"><div class="row-title">${esc(p.title)}</div><div class="row-sub">${esc(relDay(p.date))}${p.notes ? " · " + esc(p.notes) : ""}</div></div>
              ${p.targetDistance ? `<span class="row-meta">${p.targetDistance} km</span>` : ""}
            </li>`).join("") || `<li class="empty">Noch keine geplanten Läufe.</li>`}</ul></div>
        </section>
        <section class="section">
          <div class="section-head"><h2 class="section-title">Kilometer pro Woche</h2></div>
          <div class="card"><div class="bar-chart">${weeks.map((w, i) => `<div class="bar" title="${weekly[i].toFixed(1)} km"><i style="height:${weekly[i] ? Math.max(4, (weekly[i] / maxKm) * 100) : 0}%;background:var(--good)"></i><span>${fmtShort(w)}</span></div>`).join("")}</div></div>
        </section>
        <section class="section">
          <div class="section-head"><h2 class="section-title">Läufe</h2></div>
          <div class="card"><ul class="list">${runs.slice(0, 40).map((r) => `
            <li class="row row--click" data-run="${r.id}">
              <div class="row-main"><div class="row-title">${(Number(r.distance) || 0).toLocaleString("de-DE")} km</div>
              <div class="row-sub">${esc(relDay(r.date))}${r.duration ? " · " + M.formatDuration(r.duration) : ""}${r.pace ? " · " + r.pace + " min/km" : ""}</div></div>
              ${r.stravaUrl ? `<a class="pill pill--accent" href="${esc(r.stravaUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Strava ↗</a>` : ""}
            </li>`).join("") || `<li class="empty">Noch keine Läufe.</li>`}</ul></div>
        </section>`;
    },
    mount(root, params, query) {
      $("[data-add]", root).onclick = () => App.openRunSheet();
      const fix = $("[data-fix-run]", root);
      if (fix) fix.onclick = () => App.openRunSheet(store.get("runs", fix.dataset.fixRun));
      $("[data-plan]", root).onclick = () => App.openRunPlanSheet();
      if (query && query.get("strava")) {
        App.toast(query.get("strava") === "ok" ? "Strava verbunden ✓" : "Strava-Verbindung fehlgeschlagen", query.get("strava") !== "ok");
        history.replaceState(null, "", "#/laufen");
      }
      initStravaCard(root);
      $$("[data-run]", root).forEach((r) => r.onclick = () => App.openRunSheet(store.get("runs", r.dataset.run)));
      $$("[data-runplan]", root).forEach((r) => r.onclick = () => App.openRunPlanSheet(store.get("runPlan", r.dataset.runplan)));
    }
  });
})();
