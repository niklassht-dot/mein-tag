/* ==========================================================
   Körper: Gewichtsverlauf + Fortschrittsfotos
   BodyWeight { id = date, date, weight }
   Photo      { id, date, pose ("Vorne" | "Seite" | "Hinten"), note, weight }
              – das Bild selbst liegt einzeln im Speicher (/api/photo/:id)
   ========================================================== */

(function () {
  "use strict";
  const { esc, store, sheet, route, actions, today, fmtShort, fmtLong, fmtDate, $, $$ } = App;
  const M = window.LifeModel;

  const POSES = ["Vorne", "Seite", "Hinten"];
  const kg = (n) => (Math.round(Number(n) * 10) / 10).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const weights = () => store.all("bodyweight").filter((b) => Number(b.weight) > 0).sort((a, b) => a.date.localeCompare(b.date));

  /** Gewicht an/vor einem Datum (für Vergleiche). */
  function weightAt(date) {
    const list = weights().filter((w) => w.date <= date);
    return list.length ? Number(list[list.length - 1].weight) : null;
  }
  App.currentBodyweight = () => { const w = weights(); return w.length ? Number(w[w.length - 1].weight) : null; };

  /* ---------- Gewicht eintragen ---------- */

  App.openWeightSheet = function (entry = {}) {
    const isNew = !entry.id;
    const last = App.currentBodyweight();
    sheet({
      title: isNew ? "Gewicht eintragen" : "Gewicht bearbeiten",
      body: `
        <div class="field-row">
          <label class="field"><span>Datum</span><input class="input" type="date" name="date" value="${esc(entry.date || today())}"></label>
          <label class="field"><span>Gewicht (kg)</span><input class="input" inputmode="decimal" name="weight" value="${entry.weight ? esc(String(entry.weight).replace(".", ",")) : ""}" placeholder="${last ? kg(last) : "z. B. 82,4"}" autofocus></label>
        </div>
        <p class="hint">Am besten morgens nach dem Aufstehen wiegen. Das aktuelle Gewicht fließt auch in die Trainings-Ränge ein.</p>`,
      async onSubmit(d) {
        const w = Number(String(d.weight).replace(",", "."));
        if (!(w > 30 && w < 300) || !d.date) { App.toast("Bitte ein gültiges Gewicht eingeben.", true); return false; }
        if (!isNew && entry.id !== d.date) await store.remove("bodyweight", entry.id);
        await store.upsert("bodyweight", { id: d.date, date: d.date, weight: w });
        App.toast("Gewicht gespeichert");
      },
      onDelete: isNew ? null : () => store.remove("bodyweight", entry.id)
    });
  };
  actions.weight = () => App.openWeightSheet(store.get("bodyweight", today()) || {});

  /* ---------- Foto hinzufügen ---------- */

  function downscale(file, maxSide = 1280, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Bild nicht lesbar")); };
      img.src = url;
    });
  }

  App.openPhotoSheet = function () {
    let dataUrl = "";
    sheet({
      title: "Fortschrittsfoto",
      body: `
        <label class="photo-drop" data-drop>
          <input type="file" accept="image/*" name="file" hidden>
          <img data-preview alt="" hidden>
          <span data-drop-text>Foto aufnehmen oder auswählen</span>
        </label>
        <div class="field-row">
          <label class="field"><span>Datum</span><input class="input" type="date" name="date" value="${today()}"></label>
          <label class="field"><span>Ansicht</span><select class="select" name="pose">${POSES.map((p) => `<option>${p}</option>`).join("")}</select></label>
        </div>
        <label class="field"><span>Notiz (optional)</span><input class="input" name="note" placeholder="z. B. nach 8 Wochen Push/Pull"></label>
        <p class="hint">Fotos sind nur mit deinem PIN sichtbar. Tipp: gleiches Licht, gleicher Abstand, gleiche Uhrzeit.</p>`,
      submitLabel: "Speichern",
      onMount(el) {
        const input = $('input[type="file"]', el);
        input.onchange = async () => {
          const f = input.files[0];
          if (!f) return;
          $("[data-drop-text]", el).textContent = "Wird vorbereitet …";
          try {
            dataUrl = await downscale(f);
            const prev = $("[data-preview]", el);
            prev.src = dataUrl; prev.hidden = false;
            $("[data-drop-text]", el).textContent = "Anderes Foto wählen";
          } catch (e) { $("[data-drop-text]", el).textContent = "Bild nicht lesbar – anderes wählen"; }
        };
      },
      async onSubmit(d, form) {
        if (!dataUrl) { App.toast("Bitte zuerst ein Foto wählen.", true); return false; }
        const btn = $('button[type="submit"]', form.closest(".sheet"));
        btn.disabled = true; btn.textContent = "Lädt hoch …";
        const id = App.uid();
        try {
          await App.api("POST", "/photo", { id, image: dataUrl });
          await store.upsert("photos", { id, date: d.date || today(), pose: d.pose, note: d.note, weight: weightAt(d.date || today()) });
          App.toast("Foto gespeichert");
        } catch (e) {
          App.toast("Foto konnte nicht gespeichert werden.", true);
          btn.disabled = false; btn.textContent = "Speichern";
          return false;
        }
      }
    });
  };
  actions.photo = () => App.openPhotoSheet();

  function openPhoto(photo) {
    sheet({
      title: `${photo.pose || "Foto"} · ${fmtDate(photo.date)}`,
      body: `
        <img class="photo-full" data-photo="${esc(photo.id)}" alt="Fortschrittsfoto ${esc(fmtDate(photo.date))}">
        <p class="muted small">${photo.weight ? `${kg(photo.weight)} kg` : ""}${photo.note ? ` · ${esc(photo.note)}` : ""}</p>`,
      onMount(el) { App.hydratePhotos(el); },
      onDelete: async () => {
        await store.remove("photos", photo.id);
        App.api("DELETE", `/photo/${encodeURIComponent(photo.id)}`).catch(() => {});
      },
      deleteConfirm: "Foto endgültig löschen?"
    });
  }

  /* ---------- Diagramm ---------- */

  function weightChart(list) {
    if (list.length < 2) return `<p class="empty">Ab zwei Einträgen erscheint hier dein Verlauf.</p>`;
    const narrow = window.innerWidth < 600;
    const W = narrow ? 360 : 640, H = narrow ? 200 : 220, P = narrow ? 30 : 28;
    const vals = list.map((x) => Number(x.weight));
    const min = Math.floor(Math.min(...vals) - 0.5), max = Math.ceil(Math.max(...vals) + 0.5);
    const t0 = M.parseISO(list[0].date).getTime(), t1 = M.parseISO(list[list.length - 1].date).getTime() || t0 + 1;
    const x = (d) => P + ((M.parseISO(d).getTime() - t0) / Math.max(1, t1 - t0)) * (W - 2 * P);
    const y = (v) => H - P - ((v - min) / Math.max(0.1, max - min)) * (H - 2 * P);
    const path = list.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.weight).toFixed(1)}`).join(" ");
    // 7-Tage-Mittel als ruhige Trendlinie
    const trend = list.map((p) => {
      const from = M.addDays(p.date, -6);
      const win = list.filter((q) => q.date >= from && q.date <= p.date).map((q) => Number(q.weight));
      return { date: p.date, weight: win.reduce((a, b) => a + b, 0) / win.length };
    });
    const tpath = trend.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.weight).toFixed(1)}`).join(" ");
    const grid = [min, (min + max) / 2, max].map((v) => `<line x1="${P}" x2="${W - P}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${P - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--subtle)">${kg(v).replace(",0", "")}</text>`).join("");
    return `<svg class="weight-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gewichtsverlauf">
      ${grid}
      <path d="${path}" fill="none" stroke="var(--line-strong)" stroke-width="1.5"/>
      <path d="${tpath}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      ${list.map((p) => `<circle cx="${x(p.date)}" cy="${y(p.weight)}" r="3" fill="var(--accent)"><title>${fmtShort(p.date)}: ${kg(p.weight)} kg</title></circle>`).join("")}
      <text x="${P}" y="${H - 6}" font-size="11" fill="var(--subtle)">${fmtShort(list[0].date)}</text>
      <text x="${W - P}" y="${H - 6}" font-size="11" fill="var(--subtle)" text-anchor="end">${fmtShort(list[list.length - 1].date)}</text>
    </svg>`;
  }

  /* ---------- Seite ---------- */

  const ui = { pose: "", range: 90, compareA: "", compareB: "" };

  route("/koerper", {
    render() {
      const all = weights();
      const current = all.length ? all[all.length - 1] : null;
      const diff = (days) => {
        if (!current) return null;
        const ref = weightAt(M.addDays(current.date, -days));
        return ref === null ? null : Number(current.weight) - ref;
      };
      const avg7 = (() => {
        const w = all.filter((x) => x.date > M.addDays(today(), -7)).map((x) => Number(x.weight));
        return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null;
      })();
      const shown = all.filter((x) => x.date >= M.addDays(today(), -ui.range));
      const fmtDiff = (d) => (d === null ? "–" : `${d > 0 ? "+" : d < 0 ? "−" : "±"}${kg(Math.abs(d))} kg`);

      const photos = store.all("photos").sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));
      const filtered = ui.pose ? photos.filter((p) => p.pose === ui.pose) : photos;
      const byDateAsc = [...filtered].sort((a, b) => a.date.localeCompare(b.date));
      const A = store.get("photos", ui.compareA) || byDateAsc[0];
      const B = store.get("photos", ui.compareB) || byDateAsc[byDateAsc.length - 1];
      const option = (p, sel) => `<option value="${p.id}" ${sel && sel.id === p.id ? "selected" : ""}>${fmtDate(p.date)} · ${esc(p.pose || "")}</option>`;

      return `
        <header class="page-head">
          <div><p class="eyebrow">Körper</p><h1 class="page-title">Gewicht & Fortschritt</h1></div>
          <div class="chip-row">
            <button class="btn btn--soft btn--sm" data-add-photo>+ Foto</button>
            <button class="btn btn--primary btn--sm" data-add-weight>+ Gewicht</button>
          </div>
        </header>

        <div class="grid grid-4">
          <div class="card"><div class="card-kicker">Aktuell</div><div class="big-number">${current ? kg(current.weight) : "–"}<small>kg</small></div><div class="muted small">${current ? esc(App.relDay(current.date)) : "noch kein Eintrag"}</div></div>
          <div class="card"><div class="card-kicker">7 Tage</div><div class="big-number" style="font-size:26px">${fmtDiff(diff(7))}</div></div>
          <div class="card"><div class="card-kicker">30 Tage</div><div class="big-number" style="font-size:26px">${fmtDiff(diff(30))}</div></div>
          <div class="card"><div class="card-kicker">Ø 7 Tage</div><div class="big-number" style="font-size:26px">${avg7 ? kg(avg7) : "–"}<small>kg</small></div></div>
        </div>

        <section class="section">
          <div class="section-head"><h2 class="section-title">Verlauf</h2>
            <div class="chip-row">${[[30, "30 T"], [90, "90 T"], [365, "1 Jahr"], [3650, "Alles"]].map(([d, l]) => `<button class="chip ${ui.range === d ? "is-active" : ""}" data-range="${d}">${l}</button>`).join("")}</div></div>
          <div class="card">${weightChart(shown)}
            <p class="hint" style="margin-top:6px">Goldene Linie: Durchschnitt der letzten 7 Tage – glättet normale Tagesschwankungen.</p></div>
        </section>

        <section class="section">
          <div class="section-head"><h2 class="section-title">Fortschrittsfotos</h2>
            <div class="chip-row"><button class="chip ${!ui.pose ? "is-active" : ""}" data-pose="">Alle</button>${POSES.map((p) => `<button class="chip ${ui.pose === p ? "is-active" : ""}" data-pose="${p}">${p}</button>`).join("")}</div></div>
          ${byDateAsc.length >= 2 ? `
          <div class="card" style="margin-bottom:14px">
            <div class="card-title" style="margin-bottom:10px">Vergleich</div>
            <div class="compare">
              ${[A, B].map((p, i) => `
                <figure>
                  <select class="select" data-compare="${i ? "B" : "A"}">${byDateAsc.map((x) => option(x, p)).join("")}</select>
                  <img data-photo="${esc(p.id)}" alt="Foto ${esc(fmtDate(p.date))}">
                  <figcaption>${esc(fmtLong(p.date))}${p.weight ? ` · ${kg(p.weight)} kg` : ""}</figcaption>
                </figure>`).join("")}
            </div>
            ${A.weight && B.weight ? `<p class="muted small" style="margin-top:8px;text-align:center">${Math.round((M.parseISO(B.date) - M.parseISO(A.date)) / 86400000)} Tage · ${fmtDiff(B.weight - A.weight)}</p>` : ""}
          </div>` : ""}
          <div class="photo-grid">${filtered.map((p) => `
            <button type="button" class="photo-thumb" data-open-photo="${esc(p.id)}">
              <img data-photo="${esc(p.id)}" alt="Foto ${esc(fmtDate(p.date))}" loading="lazy">
              <span>${fmtShort(p.date)} · ${esc(p.pose || "")}</span>
            </button>`).join("") || `<p class="empty">Noch keine Fotos. Regelmäßig aus derselben Position fotografieren – z. B. alle 2 Wochen.</p>`}
          </div>
        </section>

        <section class="section">
          <div class="section-head"><h2 class="section-title">Einträge</h2></div>
          <div class="card"><ul class="list">${[...all].reverse().slice(0, 30).map((w, i, arr) => {
            const prev = arr[i + 1];
            const d = prev ? Number(w.weight) - Number(prev.weight) : null;
            return `<li class="row row--click" data-weight="${w.id}">
              <div class="row-main"><div class="row-title">${kg(w.weight)} kg</div><div class="row-sub">${esc(fmtLong(w.date))}</div></div>
              ${d !== null ? `<span class="row-meta">${fmtDiff(d)}</span>` : ""}
            </li>`;
          }).join("") || `<li class="empty">Noch keine Einträge.</li>`}</ul></div>
        </section>`;
    },
    mount(root) {
      $("[data-add-weight]", root).onclick = () => App.openWeightSheet(store.get("bodyweight", today()) || {});
      $("[data-add-photo]", root).onclick = () => App.openPhotoSheet();
      $$("[data-range]", root).forEach((b) => b.onclick = () => { ui.range = Number(b.dataset.range); App.render(); });
      $$("[data-pose]", root).forEach((b) => b.onclick = () => { ui.pose = b.dataset.pose; ui.compareA = ui.compareB = ""; App.render(); });
      $$("[data-compare]", root).forEach((s) => s.onchange = () => { ui[`compare${s.dataset.compare}`] = s.value; App.render(); });
      $$("[data-weight]", root).forEach((r) => r.onclick = () => App.openWeightSheet(store.get("bodyweight", r.dataset.weight)));
      $$("[data-open-photo]", root).forEach((b) => b.onclick = () => openPhoto(store.get("photos", b.dataset.openPhoto)));
      App.hydratePhotos(root);
    }
  });
})();
