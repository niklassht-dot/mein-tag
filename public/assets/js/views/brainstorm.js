/* ==========================================================
   Brainstorm Area: Ideen als Text + freie Zeichenfläche (Canvas)
   Idea   { id, text, createdAt }
   Sketch { id, title, image (JPEG data URL), createdAt }
   ========================================================== */

(function () {
  "use strict";
  const { esc, store, sheet, route, actions, $, $$, fmtShort } = App;

  App.openIdeaSheet = function (idea = {}) {
    const isNew = !idea.id;
    sheet({
      title: isNew ? "Neue Idee" : "Idee",
      body: `<textarea class="textarea" name="text" rows="8" placeholder="Einfach drauflos schreiben …" autofocus>${esc(idea.text || "")}</textarea>`,
      async onSubmit(d) { if (!d.text) return false; await store.upsert("ideas", { ...idea, text: d.text }); },
      onDelete: isNew ? null : () => store.remove("ideas", idea.id)
    });
  };
  actions.idea = () => App.openIdeaSheet();

  route("/brainstorm", {
    render() {
      const ideas = store.all("ideas").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const sketches = store.all("sketches").sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return `
        <header class="page-head">
          <div><p class="eyebrow">Spontane Ideen</p><h1 class="page-title">Brainstorm</h1></div>
          <div class="chip-row">
            <a class="btn btn--soft btn--sm" href="#/brainstorm/skizze/neu">+ Skizze</a>
            <button class="btn btn--primary btn--sm" data-add>+ Idee</button>
          </div>
        </header>
        <form class="card" data-quick style="margin-bottom:18px">
          <textarea class="textarea" name="text" rows="2" placeholder="Idee festhalten …" style="background:none;border:0;padding:0;min-height:56px"></textarea>
          <div style="display:flex;justify-content:flex-end"><button class="btn btn--primary btn--sm" type="submit">Speichern</button></div>
        </form>
        ${sketches.length ? `
        <section style="margin-bottom:26px">
          <div class="section-head"><h2 class="section-title">Skizzen</h2></div>
          <div class="sketch-grid">${sketches.map((s) => `
            <a class="sketch-thumb" href="#/brainstorm/skizze/${s.id}" title="${esc(s.title || "Skizze")}"><img src="${s.image}" alt="${esc(s.title || "Skizze")}" loading="lazy"></a>`).join("")}</div>
        </section>` : ""}
        <div class="section-head"><h2 class="section-title">Ideen</h2></div>
        <div class="idea-grid">${ideas.map((i) => `
          <button type="button" class="card card--link idea" data-idea="${i.id}" style="text-align:left;width:100%">
            <p>${esc(i.text)}</p>
            <div class="subtle small" style="margin-top:8px">${esc(fmtShort(String(i.createdAt || "").slice(0, 10)))}</div>
          </button>`).join("") || `<p class="empty">Noch keine Ideen.</p>`}</div>`;
    },
    mount(root) {
      $("[data-add]", root).onclick = () => App.openIdeaSheet();
      $$("[data-idea]", root).forEach((b) => b.onclick = () => App.openIdeaSheet(store.get("ideas", b.dataset.idea)));
      const quick = $("[data-quick]", root);
      quick.onsubmit = async (e) => {
        e.preventDefault();
        const text = quick.text.value.trim();
        if (!text) return;
        quick.text.value = "";
        await store.upsert("ideas", { text });
      };
    }
  });

  /* ---------- Zeichenfläche ---------- */

  const COLORS = ["#1d1d1f", "#d4483b", "#3a7bd5", "#2f9e63", "#a8875a"];
  const SIZES = [{ px: 2, label: "fein" }, { px: 5, label: "mittel" }, { px: 12, label: "dick" }];

  route("/brainstorm/skizze/:id", {
    autoRefresh: false,
    render(params) {
      const s = params.id === "neu" ? {} : store.get("sketches", params.id) || {};
      return `
        <a class="back-link" href="#/brainstorm">‹ Brainstorm</a>
        <header class="page-head">
          <input class="input page-title" name="title" value="${esc(s.title || "")}" placeholder="Skizze" style="font-size:30px;background:none;padding:0;min-height:0;max-width:520px" aria-label="Titel">
          <div class="chip-row">
            ${s.id ? `<button class="btn btn--danger btn--sm" data-delete>Löschen</button>` : ""}
            <button class="btn btn--primary btn--sm" data-save>Speichern</button>
          </div>
        </header>
        <div class="toolbar">
          ${COLORS.map((c, i) => `<button type="button" class="swatch ${i === 0 ? "is-active" : ""}" data-color="${c}" style="background:${c}" aria-label="Farbe"></button>`).join("")}
          <span style="width:8px"></span>
          ${SIZES.map((sz, i) => `<button type="button" class="chip ${i === 1 ? "is-active" : ""}" data-size="${sz.px}">${sz.label}</button>`).join("")}
          <button type="button" class="chip" data-eraser>Radierer</button>
          <span style="flex:1"></span>
          <button type="button" class="chip" data-undo>Rückgängig</button>
          <button type="button" class="chip" data-clear>Leeren</button>
        </div>
        <div class="canvas-wrap"><canvas id="brainstorm-canvas"></canvas></div>`;
    },
    mount(root, params) {
      const existing = params.id === "neu" ? null : store.get("sketches", params.id);
      const canvas = $("#brainstorm-canvas", root);
      const ctx = canvas.getContext("2d");
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      let color = COLORS[0], size = 5, eraser = false, drawing = false, last = null, dirty = false;
      const history = [];

      const fitCanvas = () => {
        const rect = canvas.getBoundingClientRect();
        const snapshot = canvas.width ? canvas.toDataURL() : null;
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, rect.width, rect.height);
        const src = snapshot || (existing && existing.image);
        if (src) {
          const img = new Image();
          img.onload = () => {
            const scale = Math.min(rect.width / img.width, rect.height / img.height);
            ctx.drawImage(img, 0, 0, img.width * scale, img.height * scale);
          };
          img.src = src;
        }
      };
      fitCanvas();

      const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      canvas.addEventListener("pointerdown", (e) => {
        drawing = true; dirty = true;
        canvas.setPointerCapture(e.pointerId);
        history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
        if (history.length > 25) history.shift();
        last = pos(e);
        ctx.beginPath(); ctx.arc(last.x, last.y, (eraser ? size * 3 : size) / 2, 0, Math.PI * 2);
        ctx.fillStyle = eraser ? "#fff" : color; ctx.fill();
      });
      canvas.addEventListener("pointermove", (e) => {
        if (!drawing) return;
        const p = pos(e);
        const pressure = e.pressure && e.pointerType === "pen" ? 0.5 + e.pressure : 1;
        ctx.strokeStyle = eraser ? "#fff" : color;
        ctx.lineWidth = (eraser ? size * 3 : size) * pressure;
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        last = p;
      });
      const stop = () => { drawing = false; };
      canvas.addEventListener("pointerup", stop);
      canvas.addEventListener("pointercancel", stop);

      $$("[data-color]", root).forEach((b) => b.onclick = () => {
        color = b.dataset.color; eraser = false;
        $$("[data-color]", root).forEach((x) => x.classList.toggle("is-active", x === b));
        $("[data-eraser]", root).classList.remove("is-active");
      });
      $$("[data-size]", root).forEach((b) => b.onclick = () => { size = +b.dataset.size; $$("[data-size]", root).forEach((x) => x.classList.toggle("is-active", x === b)); });
      $("[data-eraser]", root).onclick = (e) => { eraser = !eraser; e.currentTarget.classList.toggle("is-active", eraser); };
      $("[data-undo]", root).onclick = () => { const img = history.pop(); if (img) ctx.putImageData(img, 0, 0); };
      $("[data-clear]", root).onclick = async () => {
        if (!(await App.confirm("Zeichenfläche leeren?", { confirmLabel: "Leeren" }))) return;
        history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
        const r = canvas.getBoundingClientRect();
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, r.width, r.height); dirty = true;
      };

      const save = async () => {
        // auf max. 1600 px Breite verkleinern, als JPEG speichern
        const maxW = 1600;
        const scale = Math.min(1, maxW / canvas.width);
        const out = document.createElement("canvas");
        out.width = Math.round(canvas.width * scale);
        out.height = Math.round(canvas.height * scale);
        out.getContext("2d").drawImage(canvas, 0, 0, out.width, out.height);
        const image = out.toDataURL("image/jpeg", 0.85);
        const saved = await store.upsert("sketches", { ...(existing || {}), title: $('[name="title"]', root).value.trim(), image });
        dirty = false;
        App.toast("Skizze gespeichert");
        if (!existing) history.length = 0, App.go(`#/brainstorm/skizze/${saved.id}`);
      };
      $("[data-save]", root).onclick = save;
      const del = $("[data-delete]", root);
      if (del) del.onclick = async () => {
        if (await App.confirm("Skizze löschen?")) { await store.remove("sketches", existing.id); App.go("#/brainstorm"); }
      };

      let resizeTimer;
      const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(fitCanvas, 200); };
      window.addEventListener("resize", onResize);
      const beforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
      window.addEventListener("beforeunload", beforeUnload);
      return () => { window.removeEventListener("resize", onResize); window.removeEventListener("beforeunload", beforeUnload); };
    }
  });
})();
