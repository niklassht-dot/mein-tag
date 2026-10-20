/* ==========================================================
   Aufwind Studio – Follow-up-Terminlogik
   Wird im Browser (window.AufwindSchedule) UND auf dem Server
   (Netlify Function, globalThis.AufwindSchedule) verwendet,
   damit beide immer dieselben Termine berechnen.

   Regeln:
     Entwurf verschickt (manuell) → Anruf 5 Tage später.
     Fällt der Anruf auf Samstag, Sonntag oder einen gesetzlichen
     Feiertag, rutscht er auf den nächsten regulären Werktag.
     Aufgaben (Anruf, eigener Follow-up-Termin) bleiben offen, bis sie
     abgehakt werden – nicht Erledigtes erscheint unter „Nachholen“.

   Feiertage: bundesweit + Mecklenburg-Vorpommern
   (Internationaler Frauentag 8.3., Reformationstag 31.10.).
   ========================================================== */

(function (root) {
  "use strict";

  const CALL_AFTER_DRAFT_DAYS = 5;
  const CLOSED_STATUSES = ["Kunde", "Erledigt", "Abgelehnt"];

  const pad = (n) => String(n).padStart(2, "0");

  /** Arbeitet rein mit Kalenderdaten (UTC-Mitternacht), keine Zeitzonen-Effekte. */
  function parseISO(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return null;
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }

  function toISO(date) {
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }

  function addDays(date, days) {
    const d = new Date(date.getTime());
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  /** Ostersonntag (Gaußsche Osterformel, Anonymer Gregorianischer Algorithmus). */
  function easterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
  }

  const holidayCache = {};

  /** Gesetzliche Feiertage eines Jahres: { "YYYY-MM-DD": "Name" } */
  function holidays(year) {
    if (holidayCache[year]) return holidayCache[year];
    const easter = easterSunday(year);
    const list = {
      [`${year}-01-01`]: "Neujahr",
      [`${year}-03-08`]: "Internationaler Frauentag",
      [toISO(addDays(easter, -2))]: "Karfreitag",
      [toISO(addDays(easter, 1))]: "Ostermontag",
      [`${year}-05-01`]: "Tag der Arbeit",
      [toISO(addDays(easter, 39))]: "Christi Himmelfahrt",
      [toISO(addDays(easter, 50))]: "Pfingstmontag",
      [`${year}-10-03`]: "Tag der Deutschen Einheit",
      [`${year}-10-31`]: "Reformationstag",
      [`${year}-12-25`]: "1. Weihnachtsfeiertag",
      [`${year}-12-26`]: "2. Weihnachtsfeiertag"
    };
    holidayCache[year] = list;
    return list;
  }

  function holidayName(iso) {
    const d = parseISO(iso);
    if (!d) return "";
    return holidays(d.getUTCFullYear())[iso] || "";
  }

  function isWorkday(iso) {
    const d = parseISO(iso);
    if (!d) return false;
    const wd = d.getUTCDay(); // 0 = So, 6 = Sa
    return wd !== 0 && wd !== 6 && !holidayName(iso);
  }

  /**
   * Datum + n Kalendertage, danach auf den nächsten Werktag schieben.
   * Ergebnis: { date, planned, shifted, reasons: ["Samstag", "Reformationstag", …] }
   */
  function addDaysToWorkday(iso, days) {
    const start = parseISO(iso);
    if (!start) return null;
    const planned = toISO(addDays(start, days));
    let current = planned;
    const reasons = [];
    while (!isWorkday(current)) {
      const d = parseISO(current);
      const wd = d.getUTCDay();
      const name = holidayName(current);
      reasons.push(name || (wd === 6 ? "Samstag" : "Sonntag"));
      current = toISO(addDays(d, 1));
    }
    return { date: current, planned, shifted: current !== planned, reasons };
  }

  /**
   * Automatischer Anruftermin aus "Entwurf verschickt".
   * Gibt null zurück, wenn kein Datum gesetzt ist.
   */
  function computeFollowUps(draftSentDate) {
    if (!parseISO(draftSentDate)) return null;
    return { call: addDaysToWorkday(draftSentDate, CALL_AFTER_DRAFT_DAYS) };
  }

  /** Ganze Tage zwischen zwei ISO-Daten (b - a). */
  function daysBetween(a, b) {
    const da = parseISO(a);
    const db = parseISO(b);
    if (!da || !db) return 0;
    return Math.round((db - da) / 86400000);
  }

  /**
   * Aufgaben eines Leads mit Zustand.
   *   kind:  "call"   – Anruf nach Entwurf (automatisch)
   *          "manual" – selbst gesetzter Follow-up-Termin
   *   state: "done" | "overdue" (nachholen) | "due" (heute) | "upcoming" | "closed"
   * Eine Aufgabe gilt als erledigt, wenn sie für genau diesen Termin abgehakt wurde
   * (callDoneFor = Entwurfsdatum, followUpDoneFor = Follow-up-Datum).
   */
  function leadTasks(lead, today) {
    const tasks = [];
    if (!lead) return tasks;
    const closed = CLOSED_STATUSES.includes(lead.status);
    const auto = computeFollowUps(lead.draftSentDate);

    const stateOf = (date, done) => {
      if (done) return "done";
      if (closed) return "closed";
      if (date < today) return "overdue";
      if (date === today) return "due";
      return "upcoming";
    };

    if (auto) {
      const done = Boolean(lead.callDoneFor) && lead.callDoneFor === lead.draftSentDate;
      tasks.push({
        kind: "call",
        label: "Anruf",
        date: auto.call.date,
        info: auto.call,
        done,
        doneOn: done ? lead.callDoneOn || "" : "",
        state: stateOf(auto.call.date, done)
      });
    }
    if (parseISO(lead.followUpDate)) {
      const done = Boolean(lead.followUpDoneFor) && lead.followUpDoneFor === lead.followUpDate;
      tasks.push({
        kind: "manual",
        label: "Follow-up",
        date: lead.followUpDate,
        done,
        doneOn: done ? lead.followUpDoneOn || "" : "",
        state: stateOf(lead.followUpDate, done)
      });
    }
    return tasks;
  }

  /** Felder, die beim Abhaken / Zurücksetzen einer Aufgabe gespeichert werden. */
  function doneUpdates(lead, kind, done, today) {
    if (kind === "call") {
      return done ? { callDoneFor: lead.draftSentDate, callDoneOn: today } : { callDoneFor: "", callDoneOn: "" };
    }
    return done ? { followUpDoneFor: lead.followUpDate, followUpDoneOn: today } : { followUpDoneFor: "", followUpDoneOn: "" };
  }

  /** Heutiges Datum in Deutschland (für Server und Browser gleich). */
  function todayInGermany(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(now);
    const get = (t) => parts.find((p) => p.type === t).value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  }

  function hourInGermany(now = new Date()) {
    return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }).format(now)) % 24;
  }

  const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

  /** "Mo, 20.10.2026" */
  function formatWithWeekday(iso) {
    const d = parseISO(iso);
    if (!d) return "";
    return `${WEEKDAYS[d.getUTCDay()]}, ${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
  }

  root.AufwindSchedule = {
    CALL_AFTER_DRAFT_DAYS,
    CLOSED_STATUSES,
    leadTasks,
    doneUpdates,
    daysBetween,
    holidays,
    holidayName,
    isWorkday,
    addDaysToWorkday,
    computeFollowUps,
    todayInGermany,
    hourInGermany,
    formatWithWeekday
  };
})(typeof window !== "undefined" ? window : globalThis);
