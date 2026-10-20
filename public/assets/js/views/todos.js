/* ==========================================================
   To-dos mit selbst erstellten Tags (Name + Farbe)
   Todo { id, title, date, completed, tagId }
   Tag  { id, name, color }
   ========================================================== */

(function () {
  "use strict";
  const { esc, store, sheet, route, actions, today, relDay } = App;

  /* ---------- To-do anlegen / bearbeiten ---------- */

  App.openTodoSheet = function (todo = {}) {
    const isNew = !todo.id;
    const tags = store.all("tags");
    sheet({
      title: isNew ? "Neues To-do" : "To-do bearbeiten",
      body: `
        <label class="field"><span>Aufgabe</span><input class="input" name="title" value="${esc(todo.title || "")}" autofocus required></label>
        <div class="field-row">
          <label class="field"><span>Datum</span><input class="input" type="date" name="date" value="${esc(todo.date ?? today())}"></label>
          <label class="field"><span>Tag</span>
            <select class="select" name="tagId">
              <option value="">Ohne Tag</option>
              ${tags.map((t) => `<option value="${t.id}" ${t.id === todo.tagId ? "selected" : ""}>${esc(t.name)}</option>`).join("")}
            </select>
          </label>
        </div>
        <button type="button" class="btn btn--ghost btn--sm" data-manage-tags style="align-self:flex-start">Tags verwalten</button>
        ${isNew ? "" : `<label class="check"><input type="checkbox" name="completed" ${todo.completed ? "checked" : ""}> Erledigt</label>`}`,
      onMount(el, close) {
        el.querySelector("[data-manage-tags]").addEventListener("click", () => { close(); App.openTagManager(() => App.openTodoSheet(todo)); });
      },
      async onSubmit(data) {
        if (!data.title) { App.toast("Bitte eine Aufgabe eingeben.", true); return false; }
        await store.upsert("todos", { ...todo, title: data.title, date: data.date, tagId: data.tagId, completed: isNew ? false : data.completed });
      },
      onDelete: isNew ? null : () => store.remove("todos", todo.id)
    });
  };

  App.toggleTodo = (todo) => store.upsert("todos", { ...todo, completed: !todo.completed, completedOn: !todo.completed ? today() : "" });

  actions.todo = () => App.openTodoSheet();

  /* ---------- Tags verwalten (keine Vorgaben) ---------- */

  App.openTagManager = function (after) {
    const tags = store.all("tags");
    sheet({
      title: "Tags",
      body: `
        <p class="hint">Eigene Tags mit Farbe anlegen, z. B. „Sport“ in Rot oder „Gesundheit“ in Weiß.</p>
        <ul class="list">${tags.map((t) => `
          <li class="row">
            <input type="color" value="${esc(t.color || "#999999")}" data-tag-color="${t.id}" aria-label="Farbe ${esc(t.name)}" style="width:38px;height:38px;border:0;background:none;padding:0">
            <input class="input" value="${esc(t.name)}" data-tag-name="${t.id}" aria-label="Name">
            <button type="button" class="icon-btn" data-tag-del="${t.id}" aria-label="Tag löschen">×</button>
          </li>`).join("") || `<li class="empty">Noch keine Tags.</li>`}
        </ul>
        <div class="field"><span class="label">Neuer Tag</span>
          <div class="color-swatches">
            <input type="color" name="color" value="#a8875a" aria-label="Farbe">
            <input class="input" name="name" placeholder="Name" style="flex:1;min-width:140px">
          </div>
        </div>`,
      submitLabel: "Fertig",
      onMount(el) {
        el.querySelectorAll("[data-tag-del]").forEach((b) => b.addEventListener("click", async () => {
          const ok = await App.confirm("Tag löschen? To-dos behalten ihre Einträge ohne Tag.");
          if (ok) { await store.remove("tags", b.dataset.tagDel); b.closest(".row").remove(); }
        }));
      },
      async onSubmit(data, form) {
        const updates = [];
        form.querySelectorAll("[data-tag-name]").forEach((input) => {
          const tag = store.get("tags", input.dataset.tagName);
          const color = form.querySelector(`[data-tag-color="${tag.id}"]`).value;
          if (tag && (tag.name !== input.value.trim() || tag.color !== color) && input.value.trim()) {
            updates.push(store.upsert("tags", { ...tag, name: input.value.trim(), color }));
          }
        });
        if (data.name) updates.push(store.upsert("tags", { name: data.name, color: data.color }));
        await Promise.all(updates);
        if (after) setTimeout(after, 460);
      }
    });
  };

  /* ---------- Liste ---------- */

  App.todoRowHTML = function (t) {
    const tag = t.tagId ? store.get("tags", t.tagId) : null;
    const overdue = !t.completed && t.date && t.date < today();
    return `<li class="row ${t.completed ? "is-done" : ""}" data-todo="${t.id}">
      <button type="button" class="tick" role="checkbox" aria-checked="${Boolean(t.completed)}" data-tick="${t.id}" aria-label="Erledigt"></button>
      <div class="row-main row--click" data-edit-todo="${t.id}">
        <div class="row-title">${esc(t.title)}</div>
        ${tag ? `<div class="row-sub"><span class="tag-dot" style="background:${esc(tag.color)};display:inline-block;vertical-align:-1px"></span> ${esc(tag.name)}</div>` : ""}
      </div>
      ${t.date ? `<span class="pill ${overdue ? "pill--bad" : ""}">${esc(relDay(t.date))}</span>` : ""}
    </li>`;
  };

  App.bindTodoRows = function (root) {
    root.querySelectorAll("[data-tick]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = store.get("todos", b.dataset.tick);
      if (t) App.toggleTodo(t);
    }));
    root.querySelectorAll("[data-edit-todo]").forEach((r) => r.addEventListener("click", () => {
      const t = store.get("todos", r.dataset.editTodo);
      if (t) App.openTodoSheet(t);
    }));
  };

  const ui = { filter: "open", sort: "date", tag: "" };

  route("/todos", {
    render() {
      const tags = store.all("tags");
      let list = store.all("todos").filter((t) => ui.filter === "all" || (ui.filter === "open" ? !t.completed : t.completed));
      if (ui.tag) list = list.filter((t) => t.tagId === ui.tag);
      const byDate = (a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.title.localeCompare(b.title, "de");

      let body;
      if (ui.sort === "tag") {
        const groups = [...tags.map((t) => ({ tag: t, items: list.filter((x) => x.tagId === t.id) })),
          { tag: null, items: list.filter((x) => !x.tagId || !store.get("tags", x.tagId)) }].filter((g) => g.items.length);
        body = groups.map((g) => `
          <section class="card" style="margin-bottom:14px">
            <div class="card-head"><div class="card-title" style="display:flex;align-items:center;gap:8px">
              ${g.tag ? `<span class="tag-dot" style="background:${esc(g.tag.color)}"></span>${esc(g.tag.name)}` : "Ohne Tag"}</div>
              <span class="muted small">${g.items.length}</span></div>
            <ul class="list">${g.items.sort(byDate).map(App.todoRowHTML).join("")}</ul>
          </section>`).join("") || `<div class="card"><p class="empty">Keine To-dos.</p></div>`;
      } else {
        body = `<section class="card"><ul class="list">${list.sort(byDate).map(App.todoRowHTML).join("") || `<li class="empty">Keine To-dos.</li>`}</ul></section>`;
      }

      return `
        <header class="page-head">
          <div><p class="eyebrow">To-dos</p><h1 class="page-title">Aufgaben</h1></div>
          <div class="chip-row">
            <button class="btn btn--soft btn--sm" data-tags>Tags</button>
            <button class="btn btn--primary btn--sm" data-add>+ To-do</button>
          </div>
        </header>
        <div class="chip-row" style="margin-bottom:10px">
          ${[["open", "Offen"], ["done", "Erledigt"], ["all", "Alle"]].map(([k, l]) => `<button class="chip ${ui.filter === k ? "is-active" : ""}" data-filter="${k}">${l}</button>`).join("")}
          <span style="width:12px"></span>
          ${[["date", "Nach Datum"], ["tag", "Nach Tag"]].map(([k, l]) => `<button class="chip ${ui.sort === k ? "is-active" : ""}" data-sort="${k}">${l}</button>`).join("")}
        </div>
        ${tags.length ? `<div class="chip-row" style="margin-bottom:18px">
          <button class="chip ${!ui.tag ? "is-active" : ""}" data-tag="">Alle Tags</button>
          ${tags.map((t) => `<button class="chip ${ui.tag === t.id ? "is-active" : ""}" data-tag="${t.id}"><span class="tag-dot" style="background:${esc(t.color)}"></span>${esc(t.name)}</button>`).join("")}
        </div>` : `<p class="hint" style="margin-bottom:18px">Tipp: Unter „Tags“ eigene Kategorien mit Farben anlegen.</p>`}
        ${body}`;
    },
    mount(root) {
      root.querySelector("[data-add]").onclick = () => App.openTodoSheet();
      root.querySelector("[data-tags]").onclick = () => App.openTagManager();
      root.querySelectorAll("[data-filter]").forEach((b) => b.onclick = () => { ui.filter = b.dataset.filter; App.render(); });
      root.querySelectorAll("[data-sort]").forEach((b) => b.onclick = () => { ui.sort = b.dataset.sort; App.render(); });
      root.querySelectorAll("[data-tag]").forEach((b) => b.onclick = () => { ui.tag = b.dataset.tag; App.render(); });
      App.bindTodoRows(root);
    }
  });
})();
