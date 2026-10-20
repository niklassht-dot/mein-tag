/* ==========================================================
   Training Track
   WorkoutPlan { id, name, exercises: [Exercise] }
   Exercise    { name, muscles: [muscleId], sets, reps }
   WorkoutSession { id, date, planId, name, active, startedAt, durationMin,
                    exercises: [{ name, muscles, sets: [ExerciseSet] }] }
   ExerciseSet { weight, reps }
   MuscleProgress / EnduranceProgress werden aus den Daten berechnet (model.js).
   ========================================================== */

(function () {
  "use strict";
  const { esc, store, sheet, route, actions, today, fmtShort, fmtLong, relDay, $, $$ } = App;
  const M = window.LifeModel;

  const muscleName = (id) => (M.MUSCLES.find((m) => m.id === id) || {}).name || id;
  const fmtKg = (n) => (Math.round(Number(n) * 10) / 10).toLocaleString("de-DE");
  const fmtSet = (s) => s ? (Number(s.weight) ? `${fmtKg(s.weight)} kg × ${s.reps}` : `${s.reps} Wdh.`) : "–";

  /* ---------- Körperabbildung ---------- */

  /** Rang-Abzeichen (Wappen) */
  function emblem(rank, size = 44) {
    if (!rank) return `<svg width="${size}" height="${size}" viewBox="0 0 48 52" aria-hidden="true"><path d="M24 2l20 8v14c0 13-9 22-20 26C13 46 4 37 4 24V10z" fill="var(--fill)" stroke="var(--line-strong)"/><text x="24" y="31" text-anchor="middle" font-size="14" font-weight="700" fill="var(--subtle)">?</text></svg>`;
    const id = `g${Math.random().toString(36).slice(2, 8)}`;
    return `<svg width="${size}" height="${size}" viewBox="0 0 48 52" role="img" aria-label="${esc(rank.label)}">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="${rank.color}"/><stop offset="1" stop-color="${rank.color}" stop-opacity=".85"/></linearGradient></defs>
      <path d="M24 2l20 8v14c0 13-9 22-20 26C13 46 4 37 4 24V10z" fill="url(#${id})" stroke="${rank.color}" stroke-width="1.5"/>
      <path d="M24 9l13 5v10c0 8-6 14-13 17-7-3-13-9-13-17V14z" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.2"/>
      <text x="24" y="31" text-anchor="middle" font-size="${rank.division ? 13 : 16}" font-weight="800" fill="#fff" font-family="-apple-system,system-ui,sans-serif">${rank.division || "★"}</text>
    </svg>`;
  }
  App.rankEmblem = emblem;

  /** Profil + aktuelles Körpergewicht (letzter Eintrag aus „Körper“, sonst Profil). */
  function profile() {
    const p = store.get("settings", "profile") || {};
    const latest = store.all("bodyweight").filter((b) => Number(b.weight) > 0).sort((a, b) => b.date.localeCompare(a.date))[0];
    return latest ? { ...p, bodyweight: Number(latest.weight) } : p;
  }
  function currentRanks() {
    const sessions = store.all("sessions").filter((s) => !s.active);
    return M.strengthRanks(sessions, profile().bodyweight, today());
  }
  App.overallStrengthRank = () => M.overallRank(currentRanks());

  function bodySVG(muscles, side) {
    const L = Object.fromEntries(muscles.map((m) => [m.id, m]));
    const fill = (id) => (L[id] && L[id].rank ? L[id].rank.color : "var(--line-strong)");
    const m = (id, shape) => `<g><title>${esc(muscleName(id))}: ${L[id] && L[id].rank ? esc(L[id].rank.label) : "noch kein Rang"}</title>${shape.replace(/<(\w+)/g, `<$1 class="m" fill="${fill(id)}" fill-opacity="${L[id] && L[id].rank ? 0.9 : 0.5}"`)}</g>`;
    const silhouette = `
      <circle class="silhouette" cx="100" cy="36" r="22"/>
      <rect class="silhouette" x="90" y="54" width="20" height="18" rx="6"/>
      <rect class="silhouette" x="58" y="72" width="84" height="140" rx="32"/>
      <rect class="silhouette" x="34" y="84" width="24" height="140" rx="12"/>
      <rect class="silhouette" x="142" y="84" width="24" height="140" rx="12"/>
      <rect class="silhouette" x="66" y="200" width="32" height="200" rx="15"/>
      <rect class="silhouette" x="102" y="200" width="32" height="200" rx="15"/>`;
    const front = [
      m("shoulders", `<ellipse cx="62" cy="90" rx="15" ry="13"/><ellipse cx="138" cy="90" rx="15" ry="13"/>`),
      m("chest", `<ellipse cx="83" cy="110" rx="18" ry="14"/><ellipse cx="117" cy="110" rx="18" ry="14"/>`),
      m("biceps", `<ellipse cx="46" cy="132" rx="9" ry="21"/><ellipse cx="154" cy="132" rx="9" ry="21"/>`),
      m("forearms", `<ellipse cx="46" cy="186" rx="8" ry="24"/><ellipse cx="154" cy="186" rx="8" ry="24"/>`),
      m("abs", `<rect x="85" y="128" width="30" height="66" rx="10"/>`),
      m("quads", `<ellipse cx="82" cy="262" rx="14" ry="44"/><ellipse cx="118" cy="262" rx="14" ry="44"/>`),
      m("calves", `<ellipse cx="82" cy="352" rx="10" ry="30"/><ellipse cx="118" cy="352" rx="10" ry="30"/>`)
    ].join("");
    const back = [
      m("shoulders", `<ellipse cx="62" cy="90" rx="15" ry="13"/><ellipse cx="138" cy="90" rx="15" ry="13"/>`),
      m("back", `<path d="M76 84 Q100 76 124 84 L132 150 Q100 182 68 150 Z"/>`),
      m("triceps", `<ellipse cx="46" cy="132" rx="9" ry="21"/><ellipse cx="154" cy="132" rx="9" ry="21"/>`),
      m("forearms", `<ellipse cx="46" cy="186" rx="8" ry="24"/><ellipse cx="154" cy="186" rx="8" ry="24"/>`),
      m("glutes", `<ellipse cx="85" cy="214" rx="16" ry="16"/><ellipse cx="115" cy="214" rx="16" ry="16"/>`),
      m("hamstrings", `<ellipse cx="82" cy="272" rx="13" ry="38"/><ellipse cx="118" cy="272" rx="13" ry="38"/>`),
      m("calves", `<ellipse cx="82" cy="352" rx="11" ry="30"/><ellipse cx="118" cy="352" rx="11" ry="30"/>`)
    ].join("");
    return `<svg viewBox="0 0 200 420" role="img" aria-label="Körper ${side === "front" ? "vorne" : "hinten"}">${silhouette}${side === "front" ? front : back}</svg>`;
  }

  /* ---------- Training starten ---------- */

  function lastSetsFor(name) {
    const hist = M.exerciseHistory(store.all("sessions").filter((s) => !s.active), name);
    return hist.length ? hist[hist.length - 1] : null;
  }

  async function startSession(plan) {
    const exercises = plan ? (plan.exercises || []).map((ex) => {
      const last = lastSetsFor(ex.name);
      const count = Number(ex.sets) || (last ? last.sets.length : 3) || 3;
      return {
        name: ex.name,
        muscles: ex.muscles || [],
        sets: Array.from({ length: count }, (_, i) => ({
          weight: last && last.sets[i] ? last.sets[i].weight : (last && last.best ? last.best.weight : ""),
          reps: "",
          target: ex.reps || ""
        }))
      };
    }) : [];
    const session = await store.upsert("sessions", {
      date: today(), planId: plan ? plan.id : "", name: plan ? plan.name : "Freies Training",
      active: true, startedAt: new Date().toISOString(), exercises
    });
    App.go(`#/training/session/${session.id}`);
  }

  actions.session = function () {
    const active = store.all("sessions").find((s) => s.active);
    if (active) return App.go(`#/training/session/${active.id}`);
    const plans = store.all("plans");
    sheet({
      title: "Training starten",
      body: `
        <ul class="list">${plans.map((p) => `
          <li class="row row--click" data-start="${p.id}">
            <div class="row-main"><div class="row-title">${esc(p.name)}</div>
            <div class="row-sub">${(p.exercises || []).map((e) => esc(e.name)).join(" · ") || "Keine Übungen"}</div></div>
            <span class="pill pill--accent">Start</span>
          </li>`).join("") || `<li class="empty">Noch kein Trainingsplan – du kannst frei starten oder einen Plan anlegen.</li>`}
        </ul>
        <button type="button" class="btn btn--soft btn--block" data-start="">Freies Training</button>`,
      onMount(el, close) {
        $$("[data-start]", el).forEach((b) => b.addEventListener("click", () => {
          close();
          startSession(plans.find((p) => p.id === b.dataset.start) || null);
        }));
      }
    });
  };

  /* ---------- Übersicht ---------- */

  route("/training", {
    render() {
      const sessions = store.all("sessions").filter((s) => !s.active);
      const active = store.all("sessions").find((s) => s.active);
      const ws = M.weekStart(today());
      const progress = M.weeklyStrengthProgress(sessions, ws);
      const bw = Number(profile().bodyweight) || 0;
      const ranks = currentRanks();
      const overall = M.overallRank(ranks);
      const muscles = M.muscleRanks(ranks);
      const endurance = M.enduranceRank(store.all("runs"));
      const plans = store.all("plans");
      const recent = [...sessions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
      const exercises = M.knownExercises(sessions, plans);
      const thisWeek = sessions.filter((s) => M.inRange(s.date, ws, M.addDays(ws, 6))).length;
      const pct = progress.percent;

      return `
        <header class="page-head">
          <div><p class="eyebrow">Training Track</p><h1 class="page-title">Training</h1></div>
          <div class="chip-row">
            <button class="btn btn--soft btn--sm" data-new-plan>+ Plan</button>
            <button class="btn btn--primary btn--sm" data-start>${active ? "Training fortsetzen" : "Training starten"}</button>
          </div>
        </header>

        <div class="grid grid-3">
          <div class="card">
            <div class="card-kicker">Kraftfortschritt diese Woche</div>
            <div class="big-number ${pct > 0 ? "trend-up" : pct < 0 ? "trend-down" : ""}">${pct === null ? "–" : `${pct > 0 ? "+" : ""}${pct.toLocaleString("de-DE")} %`}</div>
            <div class="muted small">${pct === null ? "Vergleich, sobald eine Übung diese und letzte Woche trainiert wurde." : `über ${progress.details.length} Übung${progress.details.length > 1 ? "en" : ""} vs. Vorwoche`}</div>
          </div>
          <div class="card">
            <div class="card-kicker">Einheiten diese Woche</div>
            <div class="big-number">${thisWeek}<small>Trainings</small></div>
            <div class="muted small">${sessions.length} insgesamt</div>
          </div>
          <a class="card card--link" href="#/laufen">
            <div class="card-kicker">Ausdauer-Rang</div>
            ${endurance ? `<div style="display:flex;align-items:center;gap:10px;margin-top:4px">${emblem(endurance.rank, 40)}<div><div class="big-number" style="font-size:24px">${esc(endurance.rank.label)}</div>
              <div class="muted small">5 km ≈ ${M.formatDuration(endurance.est5k, false)}${endurance.nextTime ? ` · ${esc(endurance.rank.next.name)} ab ${M.formatDuration(endurance.nextTime, false)}` : ""}</div></div></div>`
              : `<div class="muted small" style="margin-top:6px">Rang ab dem ersten Lauf über 3 km.</div>`}
          </a>
        </div>

        ${!bw ? `
        <form class="card" data-bw style="margin-top:14px;display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap">
          <label class="field" style="flex:1;min-width:200px"><span>Körpergewicht (kg) – für die Ränge</span><input class="input" name="bodyweight" inputmode="decimal" placeholder="z. B. 82"></label>
          <button class="btn btn--primary" type="submit">Speichern</button>
        </form>` : ""}

        <section class="section">
          <div class="section-head"><h2 class="section-title">Dein Rang</h2>${bw ? `<button class="section-link" data-edit-bw style="background:none">${String(bw).replace(".", ",")} kg ändern</button>` : ""}</div>
          <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:16px" data-two>
            <div class="card">
              <div class="rank-hero">
                ${emblem(overall, 76)}
                <div>
                  <div class="card-kicker">Gesamt</div>
                  <div class="big-number">${overall ? esc(overall.label) : "Noch kein Rang"}</div>
                  ${overall && overall.next ? `<div class="progress" style="margin-top:8px"><span style="width:${Math.round(overall.progress * 100)}%;background:${overall.color}"></span></div><div class="progress-meta"><span>${esc(overall.name)}</span><span>${esc(overall.next.name)}</span></div>` : ""}
                </div>
              </div>
              <div class="body-map" style="margin-top:14px">
                <div>${bodySVG(muscles, "front")}<div class="body-caption">vorne</div></div>
                <div>${bodySVG(muscles, "back")}<div class="body-caption">hinten</div></div>
              </div>
              <div class="rank-legend">${M.RANKS.map((r) => `<span><i style="background:${r.color}"></i>${r.name}</span>`).join("")}</div>
            </div>
            <div class="card">
              <div class="card-title" style="margin-bottom:4px">Übungen</div>
              <p class="hint" style="margin-bottom:6px">Maßstab: geschätztes Maximum im Verhältnis zum Körpergewicht, verglichen mit Kraftwerten von Männern. <b>Gold</b> ≈ regelmäßig trainierende Männer, Platin ≈ fortgeschritten, Diamant ≈ sehr stark.</p>
              <ul class="list">${ranks.map((r) => `
                <li class="row row--click" onclick="location.hash='#/training/uebung/${encodeURIComponent(r.best.name || r.standard.name)}'">
                  ${emblem(r.rank, 34)}
                  <div class="row-main">
                    <div class="row-title">${esc(r.standard.name)} <span class="muted small" style="font-weight:500">· ${esc(r.rank.label)}</span></div>
                    <div class="row-sub">${r.standard.repsOnly ? `${r.best.reps} Wdh.` : `${fmtSet(r.best)} · ${r.ratio.toLocaleString("de-DE")} × KG`}${r.needed ? ` · ${esc(r.rank.next.name)}: ${r.needed.reps ? `${r.needed.reps} Wdh.` : `1RM ${r.standard.bodyweight ? "+" : ""}${fmtKg(r.needed.e1rm)} kg`}` : ""}</div>
                    ${r.rank.next ? `<div class="progress" style="margin-top:6px;height:6px"><span style="width:${Math.round(r.rank.progress * 100)}%;background:${r.rank.color}"></span></div>` : ""}
                  </div>
                </li>`).join("") || `<li class="empty">${bw ? "Trainiere eine der Rang-Übungen, um deinen Rang freizuschalten." : "Trag dein Körpergewicht ein, um Ränge zu sehen."}</li>`}
              </ul>
              <p class="hint" style="margin-top:10px">Rang-Übungen: ${M.STRENGTH_STANDARDS.map((x) => esc(x.name)).join(", ")}.</p>
            </div>
          </div>
        </section>

        ${progress.details.length ? `
        <section class="section">
          <div class="section-head"><h2 class="section-title">Woche im Vergleich</h2></div>
          <div class="card"><ul class="list">${progress.details.map((d) => `
            <li class="row row--click" onclick="location.hash='#/training/uebung/${encodeURIComponent(d.name)}'">
              <div class="row-main"><div class="row-title">${esc(d.name)}</div>
              <div class="row-sub">Vorwoche ${fmtSet(d.previous)} → diese Woche ${fmtSet(d.current)}</div></div>
              <span class="pill ${d.percent > 0 ? "pill--good" : d.percent < 0 ? "pill--bad" : ""}">${d.percent > 0 ? "+" : ""}${d.percent.toLocaleString("de-DE")} %</span>
            </li>`).join("")}</ul></div>
        </section>` : ""}

        <section class="section">
          <div class="section-head"><h2 class="section-title">Trainingspläne</h2></div>
          <div class="grid grid-3">${plans.map((p) => `
            <a class="card card--link" href="#/training/plan/${p.id}">
              <div class="card-title">${esc(p.name)}</div>
              <div class="muted small" style="margin-top:4px">${(p.exercises || []).length} Übungen</div>
              <div class="small subtle" style="margin-top:8px">${(p.exercises || []).slice(0, 4).map((e) => esc(e.name)).join(" · ")}</div>
            </a>`).join("") || `<div class="card"><p class="empty">Noch kein Plan. Lege deinen ersten Trainingsplan an.</p></div>`}
          </div>
        </section>

        <section class="section">
          <div class="section-head"><h2 class="section-title">Logbuch</h2></div>
          <div class="card"><ul class="list">${recent.map((s) => `
            <li class="row row--click" onclick="location.hash='#/training/session/${s.id}'">
              <div class="row-main"><div class="row-title">${esc(s.name || "Training")}</div>
              <div class="row-sub">${esc(relDay(s.date))} · ${(s.exercises || []).length} Übungen${s.durationMin ? ` · ${s.durationMin} min` : ""}</div></div>
              <span class="row-meta">›</span>
            </li>`).join("") || `<li class="empty">Noch keine Trainings eingetragen.</li>`}</ul></div>
        </section>

        ${exercises.length ? `
        <section class="section">
          <div class="section-head"><h2 class="section-title">Übungen vergleichen</h2></div>
          <div class="chip-row">${exercises.map((e) => `<a class="chip" href="#/training/uebung/${encodeURIComponent(e.name)}">${esc(e.name)}</a>`).join("")}</div>
        </section>` : ""}`;
    },
    mount(root) {
      $("[data-start]", root).onclick = actions.session;
      $("[data-new-plan]", root).onclick = async () => {
        const plan = await store.upsert("plans", { name: "Neuer Plan", exercises: [] });
        App.go(`#/training/plan/${plan.id}`);
      };
      const two = $("[data-two]", root);
      if (two && window.innerWidth < 760) two.style.gridTemplateColumns = "1fr";
      const saveBw = async (value) => {
        const bw = Number(String(value).replace(",", "."));
        if (!(bw > 30 && bw < 250)) { App.toast("Bitte ein Gewicht zwischen 30 und 250 kg eingeben.", true); return false; }
        await store.upsert("settings", { ...profile(), id: "profile", bodyweight: bw });
        App.toast("Körpergewicht gespeichert");
      };
      const form = $("[data-bw]", root);
      if (form) form.onsubmit = (e) => { e.preventDefault(); saveBw(form.bodyweight.value); };
      const edit = $("[data-edit-bw]", root);
      if (edit) edit.onclick = () => sheet({
        title: "Körpergewicht",
        body: `<label class="field"><span>Kilogramm</span><input class="input" name="bw" inputmode="decimal" value="${esc(String(profile().bodyweight || "").replace(".", ","))}" autofocus></label>`,
        onSubmit: (d) => saveBw(d.bw)
      });
    }
  });

  /* ---------- Trainingsplan bearbeiten ---------- */

  function exerciseEditorRow(ex, i) {
    return `
      <div class="exercise-block" data-ex="${i}">
        <div class="field-row" style="grid-template-columns:minmax(0,1fr) 70px 70px 40px;align-items:end">
          <label class="field"><span>Übung</span><input class="input" name="name" value="${esc(ex.name || "")}" list="exerciseNames" placeholder="z. B. Bankdrücken"></label>
          <label class="field"><span>Sätze</span><input class="input" name="sets" type="number" min="1" max="20" inputmode="numeric" value="${esc(ex.sets || 3)}"></label>
          <label class="field"><span>Wdh.</span><input class="input" name="reps" value="${esc(ex.reps || "")}" placeholder="8–10"></label>
          <button type="button" class="icon-btn" data-remove-ex="${i}" aria-label="Übung entfernen">×</button>
        </div>
        <div class="chip-row" style="margin-top:10px">${M.MUSCLES.map((m) => `
          <label class="chip ${(ex.muscles || []).includes(m.id) ? "is-active" : ""}"><input type="checkbox" hidden value="${m.id}" ${(ex.muscles || []).includes(m.id) ? "checked" : ""}>${m.name}</label>`).join("")}
        </div>
      </div>`;
  }

  route("/training/plan/:id", {
    autoRefresh: false,
    render(params) {
      const plan = store.get("plans", params.id);
      if (!plan) return `<a class="back-link" href="#/training">‹ Training</a><p class="empty">Plan nicht gefunden.</p>`;
      const names = M.knownExercises(store.all("sessions"), store.all("plans"));
      return `
        <a class="back-link" href="#/training">‹ Training</a>
        <header class="page-head">
          <div><p class="eyebrow">Trainingsplan</p><input class="input page-title" style="font-size:30px;background:none;padding:0;min-height:0" name="planName" value="${esc(plan.name)}" aria-label="Name des Plans"></div>
        </header>
        <datalist id="exerciseNames">${names.map((n) => `<option value="${esc(n.name)}">`).join("")}</datalist>
        <section class="card" id="planEditor">${(plan.exercises || []).map(exerciseEditorRow).join("") || ""}</section>
        <div class="chip-row" style="margin-top:14px">
          <button class="btn btn--soft" data-add-ex>+ Übung</button>
          <span style="flex:1"></span>
          <button class="btn btn--danger btn--sm" data-delete-plan>Plan löschen</button>
          <button class="btn btn--primary" data-save-plan>Speichern</button>
        </div>
        <p class="hint" style="margin-top:10px">Muskelgruppen antippen – sie bestimmen, welche Level in der Körperabbildung wachsen.</p>`;
    },
    mount(root, params) {
      const plan = store.get("plans", params.id);
      if (!plan) return;
      let exercises = JSON.parse(JSON.stringify(plan.exercises || []));
      const editor = $("#planEditor", root);

      const read = () => $$("[data-ex]", editor).map((b) => ({
        name: $('[name="name"]', b).value.trim(),
        sets: Number($('[name="sets"]', b).value) || 3,
        reps: $('[name="reps"]', b).value.trim(),
        muscles: $$('input[type="checkbox"]:checked', b).map((c) => c.value)
      }));
      const draw = () => {
        editor.innerHTML = exercises.map(exerciseEditorRow).join("") || `<p class="empty">Noch keine Übungen.</p>`;
        $$("[data-remove-ex]", editor).forEach((b) => b.onclick = () => { exercises = read(); exercises.splice(+b.dataset.removeEx, 1); draw(); });
        $$(".chip input", editor).forEach((c) => c.onchange = () => c.parentElement.classList.toggle("is-active", c.checked));
        // Bekannte Übung → Muskeln übernehmen
        $$('[name="name"]', editor).forEach((inp) => inp.addEventListener("change", () => {
          const known = M.knownExercises(store.all("sessions"), store.all("plans")).find((k) => k.name.toLowerCase() === inp.value.trim().toLowerCase());
          const block = inp.closest("[data-ex]");
          if (known && known.muscles.length && !$$('input[type="checkbox"]:checked', block).length) {
            $$('input[type="checkbox"]', block).forEach((c) => { c.checked = known.muscles.includes(c.value); c.parentElement.classList.toggle("is-active", c.checked); });
          }
        }));
      };
      draw();
      $("[data-add-ex]", root).onclick = () => { exercises = read(); exercises.push({ name: "", sets: 3, reps: "", muscles: [] }); draw(); $$('[name="name"]', editor).pop().focus(); };
      $("[data-save-plan]", root).onclick = async () => {
        await store.upsert("plans", { ...plan, name: $('[name="planName"]', root).value.trim() || "Trainingsplan", exercises: read().filter((e) => e.name) });
        App.toast("Plan gespeichert");
        App.go("#/training");
      };
      $("[data-delete-plan]", root).onclick = async () => {
        if (await App.confirm(`„${plan.name}“ löschen?`)) { await store.remove("plans", plan.id); App.go("#/training"); }
      };
    }
  });

  /* ---------- Training dokumentieren (Logbuch) ---------- */

  function setRows(ex, ei) {
    return (ex.sets || []).map((s, si) => `
      <tr class="${s.doneAt ? "is-set-done" : ""}">
        <td class="idx">${s.doneAt ? "✓" : si + 1}</td>
        <td><input class="input" inputmode="decimal" data-w="${ei}:${si}" value="${esc(s.weight ?? "")}" placeholder="kg"></td>
        <td><input class="input" inputmode="numeric" data-r="${ei}:${si}" value="${esc(s.reps ?? "")}" placeholder="${esc(s.target || "Wdh.")}"></td>
        <td class="rest-cell">${s.restBefore ? `⏱ ${App.clock(s.restBefore)}` : ""}</td>
        <td><button type="button" class="icon-btn" data-del-set="${ei}:${si}" aria-label="Satz entfernen" style="width:30px;height:30px">×</button></td>
      </tr>`).join("");
  }

  route("/training/session/:id", {
    autoRefresh: false,
    render(params) {
      const s = store.get("sessions", params.id);
      if (!s) return `<a class="back-link" href="#/training">‹ Training</a><p class="empty">Training nicht gefunden.</p>`;
      const names = M.knownExercises(store.all("sessions"), store.all("plans"));
      return `
        <a class="back-link" href="#/training">‹ Training</a>
        <header class="page-head">
          <div><p class="eyebrow">${s.active ? "Läuft" : "Logbuch"} · ${esc(relDay(s.date))}</p><h1 class="page-title">${esc(s.name || "Training")}</h1></div>
          <div class="chip-row"><input class="input" type="date" data-date value="${esc(s.date)}" style="width:auto"></div>
        </header>
        <datalist id="exerciseNames">${names.map((n) => `<option value="${esc(n.name)}">`).join("")}</datalist>
        ${s.active ? `
        <div class="workout-timer" role="timer" aria-live="off">
          <div><span class="label">Gesamt</span><b data-total>0:00</b></div>
          <div class="workout-timer__rest"><span class="label" data-rest-label>Pause</span><b data-rest>–</b></div>
        </div>` : ""}
        <section class="card" id="logger"></section>
        <div class="chip-row" style="margin-top:14px">
          <button class="btn btn--soft" data-add-exercise>+ Übung</button>
          <span style="flex:1"></span>
          <button class="btn btn--danger btn--sm" data-delete-session>Löschen</button>
          ${s.active ? `<button class="btn btn--primary" data-finish>Training beenden</button>` : `<button class="btn btn--primary" data-done>Fertig</button>`}
        </div>`;
    },
    mount(root, params) {
      const original = store.get("sessions", params.id);
      if (!original) return;
      const s = JSON.parse(JSON.stringify(original));
      const logger = $("#logger", root);
      let timer = null;

      const save = (extra = {}) => {
        clearTimeout(timer); timer = null;
        Object.assign(s, extra);
        return store.upsert("sessions", s).catch(() => {});
      };
      const queueSave = () => { clearTimeout(timer); timer = setTimeout(save, 900); };

      const draw = () => {
        logger.innerHTML = s.exercises.map((ex, ei) => {
          const last = lastSetsFor(ex.name);
          return `
          <div class="exercise-block">
            <h4><input class="input" data-name="${ei}" value="${esc(ex.name)}" list="exerciseNames" placeholder="Übung" style="font-weight:650;background:none;padding:0;min-height:0;font-size:17px">
              <button type="button" class="btn btn--ghost btn--sm" data-del-ex="${ei}">Entfernen</button></h4>
            <p class="last-time">${last && last.date !== s.date ? `Letztes Mal (${fmtShort(last.date)}): ${last.sets.map(fmtSet).join(" · ")}` : "Erstes Mal – viel Erfolg!"}</p>
            <table class="set-table"><thead><tr><th>#</th><th>Gewicht</th><th>Wdh.</th><th>Pause</th><th></th></tr></thead><tbody>${setRows(ex, ei)}</tbody></table>
            <button type="button" class="btn btn--ghost btn--sm" data-add-set="${ei}">+ Satz</button>
          </div>`;
        }).join("") || `<p class="empty">Füge deine erste Übung hinzu.</p>`;

        $$("[data-w]", logger).forEach((inp) => inp.oninput = () => { const [e, i] = inp.dataset.w.split(":"); s.exercises[e].sets[i].weight = inp.value.replace(",", ".") === "" ? "" : Number(inp.value.replace(",", ".")); queueSave(); });
        $$("[data-r]", logger).forEach((inp) => {
          inp.oninput = () => { const [e, i] = inp.dataset.r.split(":"); s.exercises[e].sets[i].reps = inp.value === "" ? "" : Number(inp.value); queueSave(); };
          // Satz fertig eingetragen → Pause-Timer startet neu (läuft bis zum nächsten Satz)
          inp.onchange = () => {
            const [e, i] = inp.dataset.r.split(":");
            const set = s.exercises[e].sets[i];
            if (!s.active || !(Number(set.reps) > 0) || set.doneAt) return;
            const now = new Date();
            set.doneAt = now.toISOString();
            if (s.lastSetAt) set.restBefore = Math.round((now - new Date(s.lastSetAt)) / 1000);
            s.lastSetAt = set.doneAt;
            save();
            draw();
            tick();
            if (navigator.vibrate) navigator.vibrate(30);
          };
        });
        $$("[data-name]", logger).forEach((inp) => inp.onchange = () => {
          const ex = s.exercises[inp.dataset.name];
          ex.name = inp.value.trim();
          const known = M.knownExercises(store.all("sessions"), store.all("plans")).find((k) => k.name.toLowerCase() === ex.name.toLowerCase());
          if (known && !(ex.muscles || []).length) ex.muscles = known.muscles;
          save(); draw();
        });
        $$("[data-add-set]", logger).forEach((b) => b.onclick = () => {
          const ex = s.exercises[b.dataset.addSet];
          const prev = ex.sets[ex.sets.length - 1] || {};
          ex.sets.push({ weight: prev.weight ?? "", reps: "", target: prev.target || "" });
          draw(); queueSave();
        });
        $$("[data-del-set]", logger).forEach((b) => b.onclick = () => { const [e, i] = b.dataset.delSet.split(":"); s.exercises[e].sets.splice(i, 1); draw(); queueSave(); });
        $$("[data-del-ex]", logger).forEach((b) => b.onclick = () => { s.exercises.splice(b.dataset.delEx, 1); draw(); save(); });
      };
      draw();

      $("[data-date]", root).onchange = (e) => save({ date: e.target.value || s.date });
      $("[data-add-exercise]", root).onclick = () => {
        sheet({
          title: "Übung hinzufügen",
          body: `<label class="field"><span>Übung</span><input class="input" name="name" list="exerciseNames2" autofocus>
            <datalist id="exerciseNames2">${M.knownExercises(store.all("sessions"), store.all("plans")).map((n) => `<option value="${esc(n.name)}">`).join("")}</datalist></label>
            <div class="label">Muskelgruppen</div>
            <div class="chip-row">${M.MUSCLES.map((m) => `<label class="chip"><input type="checkbox" hidden name="m_${m.id}">${m.name}</label>`).join("")}</div>`,
          submitLabel: "Hinzufügen",
          onMount(el) { $$(".chip input", el).forEach((c) => c.onchange = () => c.parentElement.classList.toggle("is-active", c.checked)); },
          onSubmit(data) {
            if (!data.name) return false;
            let muscles = M.MUSCLES.filter((m) => data[`m_${m.id}`]).map((m) => m.id);
            const known = M.knownExercises(store.all("sessions"), store.all("plans")).find((k) => k.name.toLowerCase() === data.name.toLowerCase());
            if (!muscles.length && known) muscles = known.muscles;
            const last = lastSetsFor(data.name);
            s.exercises.push({ name: data.name, muscles, sets: (last ? last.sets : [{}, {}, {}]).map((x) => ({ weight: x.weight ?? "", reps: "" })) });
            draw(); save();
          }
        });
      };
      const finish = $("[data-finish]", root);
      if (finish) finish.onclick = async () => {
        s.exercises.forEach((ex) => { ex.sets = ex.sets.filter((x) => Number(x.reps) > 0); });
        s.exercises = s.exercises.filter((ex) => ex.name && ex.sets.length);
        const secs = Math.max(60, Math.round((Date.now() - new Date(s.startedAt || Date.now())) / 1000));
        const rests = s.exercises.flatMap((ex) => ex.sets.map((x) => x.restBefore)).filter(Boolean);
        await save({ active: false, durationMin: Math.round(secs / 60), durationSec: secs, lastSetAt: "", avgRestSec: rests.length ? Math.round(rests.reduce((a, b) => a + b, 0) / rests.length) : null });
        App.toast("Training gespeichert 💪");
        App.go("#/training");
      };
      const done = $("[data-done]", root);
      if (done) done.onclick = async () => { await save(); App.go("#/training"); };
      $("[data-delete-session]", root).onclick = async () => {
        if (await App.confirm("Training löschen?")) { clearTimeout(timer); await store.remove("sessions", s.id); App.go("#/training"); }
      };
      // Timer: Gesamtzeit seit Start, Pause seit dem letzten eingetragenen Satz
      const totalEl = $("[data-total]", root);
      const restEl = $("[data-rest]", root);
      const tick = () => {
        if (!totalEl) return;
        totalEl.textContent = App.clock((Date.now() - new Date(s.startedAt || Date.now())) / 1000);
        restEl.textContent = s.lastSetAt ? App.clock((Date.now() - new Date(s.lastSetAt)) / 1000) : "–";
        $("[data-rest-label]", root).textContent = s.lastSetAt ? "Pause seit letztem Satz" : "Pause startet nach dem 1. Satz";
      };
      tick();
      const clockTimer = s.active ? setInterval(tick, 1000) : null;

      return () => { if (timer) save(); if (clockTimer) clearInterval(clockTimer); };
    }
  });

  /* ---------- Übung im Verlauf vergleichen ---------- */

  route("/training/uebung/:name", {
    render(params) {
      const name = params.name;
      const hist = M.exerciseHistory(store.all("sessions").filter((s) => !s.active), name);
      if (!hist.length) return `<a class="back-link" href="#/training">‹ Training</a><p class="empty">Noch keine Werte für „${esc(name)}“.</p>`;
      const max = Math.max(...hist.map((h) => h.perf));
      const best = hist.reduce((a, b) => (b.perf > a.perf ? b : a));
      const first = hist[0];
      const last = hist[hist.length - 1];
      const total = first.perf ? Math.round(((last.perf - first.perf) / first.perf) * 1000) / 10 : 0;
      const shown = hist.slice(-12);
      return `
        <a class="back-link" href="#/training">‹ Training</a>
        <header class="page-head"><div><p class="eyebrow">Übung</p><h1 class="page-title">${esc(name)}</h1></div></header>
        <div class="grid grid-3">
          <div class="card"><div class="card-kicker">Bestleistung</div><div class="big-number" style="font-size:28px">${fmtSet(best.best)}</div><div class="muted small">${esc(fmtLong(best.date))}</div></div>
          <div class="card"><div class="card-kicker">Zuletzt</div><div class="big-number" style="font-size:28px">${fmtSet(last.best)}</div><div class="muted small">${esc(relDay(last.date))}</div></div>
          <div class="card"><div class="card-kicker">Seit dem ersten Training</div><div class="big-number ${total > 0 ? "trend-up" : total < 0 ? "trend-down" : ""}" style="font-size:28px">${total > 0 ? "+" : ""}${total.toLocaleString("de-DE")} %</div><div class="muted small">${hist.length} Einheiten</div></div>
        </div>
        <section class="section">
          <div class="section-head"><h2 class="section-title">Verlauf</h2><span class="muted small">geschätztes Maximum (1RM)</span></div>
          <div class="card"><div class="bar-chart">${shown.map((h) => `<div class="bar" title="${esc(fmtSet(h.best))}"><i style="height:${Math.max(4, (h.perf / max) * 100)}%"></i><span>${fmtShort(h.date)}</span></div>`).join("")}</div></div>
        </section>
        <section class="section">
          <div class="card"><ul class="list">${[...hist].reverse().map((h, i, arr) => {
            const prev = arr[i + 1];
            const diff = prev && prev.perf ? Math.round(((h.perf - prev.perf) / prev.perf) * 1000) / 10 : null;
            return `<li class="row row--click" onclick="location.hash='#/training/session/${h.sessionId}'">
              <div class="row-main"><div class="row-title">${esc(fmtLong(h.date))}</div>
              <div class="row-sub">${h.sets.map(fmtSet).join(" · ")}</div></div>
              ${diff !== null ? `<span class="pill ${diff > 0 ? "pill--good" : diff < 0 ? "pill--bad" : ""}">${diff > 0 ? "+" : ""}${diff.toLocaleString("de-DE")} %</span>` : ""}
            </li>`;
          }).join("")}</ul></div>
        </section>`;
    }
  });


})();
