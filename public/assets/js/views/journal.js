/* ==========================================================
   Tagebuch + Tagesabschluss
   DailyEntry { date, journal, gratitude, wentWell, wentBad, wouldChange,
                procrastinatedTask, ratings: { energy, focus, mood, productivity, stress } }
   Speichert automatisch während des Schreibens.
   ========================================================== */

(function () {
  "use strict";
  const { esc, store, route, actions, today, fmtLong, relDay, $ } = App;
  const M = window.LifeModel;

  actions.closing = () => App.go(`#/tagebuch/${today()}?abschluss=1`);

  function ratingPills(r) {
    if (!r) return "";
    return `<div class="ratings-mini">${M.RATINGS.map((x) => `<span class="pill">${x.label} <b>${r[x.key] ?? "–"}</b></span>`).join("")}</div>`;
  }
  App.ratingPills = ratingPills;

  const view = {
    autoRefresh: false,
    render(params) {
      const date = params.date && M.parseISO(params.date) ? params.date : today();
      const e = store.get("entries", date) || {};
      const r = e.ratings || {};
      const history = store.all("entries").filter((x) => x.date !== date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
      const prev = M.addDays(date, -1);
      const next = M.addDays(date, 1);
      return `
        <header class="page-head">
          <div>
            <p class="eyebrow">Tagebuch · ${esc(relDay(date))}</p>
            <h1 class="page-title">${esc(fmtLong(date))}</h1>
          </div>
          <div class="day-nav">
            <a class="icon-btn" href="#/tagebuch/${prev}" aria-label="Vortag">‹</a>
            <a class="btn btn--soft btn--sm" href="#/tagebuch">Heute</a>
            <a class="icon-btn" href="#/tagebuch/${next}" aria-label="Folgetag">›</a>
          </div>
        </header>

        <form class="form" id="journalForm" data-date="${date}" autocomplete="off">
          <section class="card">
            <div class="card-head"><div class="card-title">Tagebuch</div><span class="muted small" data-save-state>${e.updatedAt ? "Gespeichert" : ""}</span></div>
            <textarea class="textarea textarea--journal" name="journal" placeholder="Was beschäftigt dich heute?">${esc(e.journal || "")}</textarea>
          </section>

          <section class="card" id="abschluss">
            <div class="card-head">
              <div><div class="card-kicker">gegen 21:15 Uhr</div><div class="card-title">Tagesabschluss</div></div>
              ${M.closingDone(e) ? `<span class="pill pill--good">Erledigt</span>` : ""}
            </div>
            <div class="form">
              ${M.CLOSING_QUESTIONS.map((q) => `
                <label class="field"><span>${esc(q.label)}</span>
                  <textarea class="textarea" name="${q.key}" rows="2">${esc(e[q.key] || "")}</textarea></label>`).join("")}
            </div>
            <div style="margin-top:18px">
              <p class="label" style="margin-bottom:4px">Bewertung (1–10)</p>
              ${M.RATINGS.map((x) => `
                <div class="slider">
                  <label for="r-${x.key}">${x.label}</label>
                  <input type="range" min="1" max="10" step="1" id="r-${x.key}" name="r_${x.key}" value="${r[x.key] ?? 5}" ${r[x.key] ? "data-touched" : ""}>
                  <output>${r[x.key] ?? 5}</output>
                </div>`).join("")}
            </div>
            <div style="display:flex;justify-content:flex-end;margin-top:14px">
              <button type="submit" class="btn btn--primary">Tagesabschluss speichern</button>
            </div>
          </section>
        </form>

        <section class="section">
          <div class="section-head"><h2 class="section-title">Letzte Einträge</h2></div>
          <div class="card">
            <ul class="list">${history.map((h) => `
              <li class="row row--click" onclick="location.hash='#/tagebuch/${h.date}'">
                <div class="row-main">
                  <div class="row-title">${esc(fmtLong(h.date))}</div>
                  <div class="row-sub">${esc((h.journal || h.wentWell || "").slice(0, 120)) || "—"}</div>
                </div>
                ${h.ratings ? `<span class="pill pill--accent">Stimmung ${h.ratings.mood}</span>` : ""}
              </li>`).join("") || `<li class="empty">Noch keine weiteren Einträge.</li>`}
            </ul>
          </div>
        </section>`;
    },

    mount(root, params, query) {
      const form = $("#journalForm", root);
      const date = form.dataset.date;
      const state = $("[data-save-state]", root);
      let timer = null;

      const collect = (withRatings) => {
        const existing = store.get("entries", date) || {};
        const data = App.formData(form);
        const entry = { ...existing, id: date, date, journal: data.journal };
        M.CLOSING_QUESTIONS.forEach((q) => { entry[q.key] = data[q.key]; });
        const touched = withRatings || form.querySelector("[data-touched]") || existing.ratings;
        if (touched) {
          entry.ratings = Object.fromEntries(M.RATINGS.map((x) => [x.key, Number(form.querySelector(`[name="r_${x.key}"]`).value)]));
        }
        return entry;
      };

      const save = async (withRatings = false) => {
        clearTimeout(timer);
        timer = null;
        state.textContent = "Speichert …";
        try {
          await store.upsert("entries", collect(withRatings));
          state.textContent = "Gespeichert";
        } catch (e) {
          state.textContent = "Nicht gespeichert";
        }
      };

      form.addEventListener("input", (e) => {
        if (e.target.type === "range") e.target.dataset.touched = "1";
        state.textContent = "…";
        clearTimeout(timer);
        timer = setTimeout(() => save(false), 1200);
      });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        await save(true);
        App.toast("Tagesabschluss gespeichert");
        App.render();
      });

      if (query.get("abschluss")) setTimeout(() => $("#abschluss", root).scrollIntoView({ behavior: "smooth", block: "start" }), 200);
      return () => { if (timer) save(false); };
    }
  };

  route("/tagebuch", view);
  route("/tagebuch/:date", view);
})();
