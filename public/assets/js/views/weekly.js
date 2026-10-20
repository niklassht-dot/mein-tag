/* ==========================================================
   Wochenfeedback + Claude-Optimierung
   Jeden Sonntag werden alle Daten der Woche (WeeklyContext) aggregiert;
   Claude erstellt daraus ein persönliches Feedback.
   ========================================================== */

(function () {
  "use strict";
  const { esc, store, route, today, fmtShort, fmtDate, $, $$ } = App;
  const M = window.LifeModel;

  /** Minimaler Markdown-Renderer (Überschriften, Listen, fett/kursiv). */
  function md(text) {
    const lines = esc(text || "").split("\n");
    let html = "", list = null;
    const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>");
    const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
    lines.forEach((l) => {
      let m;
      if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) { closeList(); html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; }
      else if ((m = /^\s*[-*•]\s+(.*)$/.exec(l))) { if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; } html += `<li>${inline(m[1])}</li>`; }
      else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; } html += `<li>${inline(m[1])}</li>`; }
      else if (!l.trim()) { closeList(); }
      else { closeList(); html += `<p>${inline(l)}</p>`; }
    });
    closeList();
    return html;
  }

  const fmt1 = (n) => (n === null || n === undefined ? "–" : Number(n).toLocaleString("de-DE"));

  let feedbackEnabled = null;

  const view = {
    render(params) {
      const ws = params.week && M.parseISO(params.week) ? M.weekStart(params.week) : M.weekStart(today());
      const we = M.addDays(ws, 6);
      const ctx = M.buildWeeklyContext(store.data(), ws, store.followups());
      const fb = store.get("feedback", ws);
      const r = ctx.dailyRatings.averages;
      const past = store.all("feedback").filter((f) => f.id !== ws).sort((a, b) => b.id.localeCompare(a.id));
      const procrastinated = ctx.journalEntries.filter((e) => e.procrastinatedTask);
      const isCurrent = ws === M.weekStart(today());

      return `
        <header class="page-head">
          <div><p class="eyebrow">Wochenfeedback</p><h1 class="page-title">${fmtShort(ws)} – ${fmtDate(we)}</h1>
            <p class="page-sub">${isCurrent ? "Laufende Woche" : "Vergangene Woche"}</p></div>
          <div class="day-nav">
            <a class="icon-btn" href="#/woche/${M.addDays(ws, -7)}" aria-label="Vorherige Woche">‹</a>
            <a class="btn btn--soft btn--sm" href="#/woche">Diese Woche</a>
            <a class="icon-btn" href="#/woche/${M.addDays(ws, 7)}" aria-label="Nächste Woche">›</a>
          </div>
        </header>

        <div class="stat-strip">
          ${M.RATINGS.map((x) => `<div class="stat"><b>${fmt1(r[x.key])}</b><span>Ø ${x.label}</span></div>`).join("")}
          <div class="stat"><b>${ctx.dailyRatings.daysWithClosing}/7</b><span>Tagesabschlüsse</span></div>
          <div class="stat"><b>${ctx.workouts.sessions.length}</b><span>Trainings</span></div>
          <div class="stat"><b>${ctx.workouts.weeklyStrengthProgressPercent === null ? "–" : (ctx.workouts.weeklyStrengthProgressPercent > 0 ? "+" : "") + fmt1(ctx.workouts.weeklyStrengthProgressPercent) + " %"}</b><span>Kraft vs. Vorwoche</span></div>
          <div class="stat"><b>${ctx.sleep.averageDurationMin ? App.fmtMinutes(ctx.sleep.averageDurationMin).replace(" min", "") : "–"}</b><span>Ø Schlaf</span></div>
          <div class="stat"><b>${fmt1(ctx.runs.totalKm)} km</b><span>gelaufen</span></div>
          <div class="stat"><b>${ctx.todos.completed}/${ctx.todos.total}</b><span>To-dos erledigt</span></div>
        </div>

        <section class="section">
          <div class="card">
            <div class="card-head">
              <div><div class="card-kicker">Claude</div><div class="card-title">Dein Feedback</div></div>
              <button class="btn ${fb ? "btn--soft" : "btn--primary"} btn--sm" data-generate>${fb ? "Neu erstellen" : "Feedback erstellen"}</button>
            </div>
            <div data-feedback>
              ${fb ? `<div class="feedback-text">${md(fb.text)}</div><p class="hint" style="margin-top:12px">Erstellt am ${esc(fmtDate(String(fb.updatedAt || fb.createdAt).slice(0, 10)))}</p>`
                : `<p class="empty">${isCurrent ? "Am Sonntag ab 19 Uhr wird das Feedback automatisch erstellt – oder jetzt manuell." : "Für diese Woche gibt es noch kein Feedback."}</p>`}
            </div>
            <div data-feedback-status class="hint" style="margin-top:10px"></div>
          </div>
        </section>

        ${procrastinated.length || ctx.todos.open.length ? `
        <section class="section">
          <div class="section-head"><h2 class="section-title">Aufgeschoben & offen</h2></div>
          <div class="grid grid-2">
            <div class="card"><div class="card-title" style="margin-bottom:8px">Laut Tagesabschluss aufgeschoben</div>
              <ul class="list">${procrastinated.map((e) => `<li class="row"><div class="row-main"><div class="row-title">${esc(e.procrastinatedTask)}</div><div class="row-sub">${esc(fmtShort(e.date))}</div></div></li>`).join("") || `<li class="empty">Nichts notiert.</li>`}</ul></div>
            <div class="card"><div class="card-title" style="margin-bottom:8px">Offene To-dos dieser Woche</div>
              <ul class="list">${ctx.todos.open.map((t) => `<li class="row"><div class="row-main"><div class="row-title">${esc(t.title)}</div><div class="row-sub">${esc(fmtShort(t.date))}${t.tag ? " · " + esc(t.tag) : ""}</div></div></li>`).join("") || `<li class="empty">Alles erledigt.</li>`}</ul></div>
          </div>
        </section>` : ""}

        ${past.length ? `
        <section class="section">
          <div class="section-head"><h2 class="section-title">Frühere Wochen</h2></div>
          <div class="card"><ul class="list">${past.map((f) => `
            <li class="row row--click" onclick="location.hash='#/woche/${f.id}'">
              <div class="row-main"><div class="row-title">${fmtShort(f.weekStart)} – ${fmtDate(f.weekEnd)}</div>
              <div class="row-sub">${esc((f.text || "").replace(/[#*]/g, "").slice(0, 120))}</div></div><span class="row-meta">›</span>
            </li>`).join("")}</ul></div>
        </section>` : ""}`;
    },

    mount(root, params) {
      const ws = params.week && M.parseISO(params.week) ? M.weekStart(params.week) : M.weekStart(today());
      const status = $("[data-feedback-status]", root);
      const showStatus = () => {
        if (feedbackEnabled === false) status.innerHTML = `Automatisches Feedback ist noch nicht eingerichtet (Claude-API-Schlüssel fehlt). Bis dahin kannst du den fertigen Auftrag kopieren und in <a href="https://claude.ai" target="_blank" rel="noopener" style="color:var(--accent)">claude.ai</a> einfügen.`;
        else if (feedbackEnabled) status.textContent = "Wird jeden Sonntag ab 19 Uhr automatisch erstellt und per Push gemeldet.";
      };
      if (feedbackEnabled === null) {
        App.api("GET", "/feedback/status").then((r) => { feedbackEnabled = r.enabled; showStatus(); }).catch(() => {});
      } else showStatus();

      $("[data-generate]", root).onclick = async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = "Claude denkt nach …";
        try {
          const res = await App.api("POST", "/feedback/generate", { weekStart: ws });
          if (res.needsKey) {
            const prompt = res.prompt;
            $("[data-feedback]", root).innerHTML = `
              <div class="banner"><div><b>Auftrag für Claude</b>Kopieren und in claude.ai einfügen – er enthält alle Daten dieser Woche.</div></div>
              <textarea class="textarea" readonly rows="8" style="margin-top:12px;font-size:13px">${esc(prompt)}</textarea>
              <div class="chip-row" style="margin-top:10px">
                <button class="btn btn--primary btn--sm" data-copy>Kopieren</button>
                <a class="btn btn--soft btn--sm" href="https://claude.ai/new" target="_blank" rel="noopener">claude.ai öffnen ↗</a>
              </div>`;
            $("[data-copy]", root).onclick = async () => {
              try { await navigator.clipboard.writeText(prompt); App.toast("Kopiert"); }
              catch (err) { $("textarea", root).select(); document.execCommand("copy"); App.toast("Kopiert"); }
            };
            btn.textContent = "Auftrag erstellt";
            return;
          }
          await App.sync();
          App.toast("Feedback erstellt");
          App.render();
        } catch (err) {
          App.toast(err.data && err.data.message ? `Claude: ${err.data.message}` : "Feedback konnte nicht erstellt werden.", true);
          btn.disabled = false;
          btn.textContent = "Erneut versuchen";
        }
      };
    }
  };

  route("/woche", view);
  route("/woche/:week", view);
})();
