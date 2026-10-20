/* ==========================================================
   Mein Tag – Datenmodell & Berechnungen
   Wird im Browser (window.LifeModel) UND auf dem Server
   (globalThis.LifeModel) verwendet: Trainingsfortschritt,
   Level, Zielfortschritt, Wochenkontext für das Feedback.
   ========================================================== */

(function (root) {
  "use strict";

  /* ---------------- Datum ---------------- */

  const pad = (n) => String(n).padStart(2, "0");

  function parseISO(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  }
  const toISO = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const addDays = (iso, n) => { const d = parseISO(iso); d.setUTCDate(d.getUTCDate() + n); return toISO(d); };

  /** Heutiges Datum + Uhrzeit in Deutschland. */
  function nowInGermany(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false
    }).formatToParts(now);
    const get = (t) => parts.find((p) => p.type === t).value;
    return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: +get("hour") % 24, minute: +get("minute") };
  }

  /** Montag der Woche (Woche = Mo–So). */
  function weekStart(iso) {
    const d = parseISO(iso);
    const wd = (d.getUTCDay() + 6) % 7;
    return addDays(iso, -wd);
  }

  const inRange = (iso, from, to) => Boolean(iso) && iso >= from && iso <= to;

  /** ISO-Wochentag: 1 = Montag … 7 = Sonntag */
  const isoWeekday = (iso) => ((parseISO(iso).getUTCDay() + 6) % 7) + 1;

  /* ---------------- Wiederkehrende Ereignisse ---------------- */

  /**
   * Findet ein Ereignis an einem Tag statt?
   *   repeat: "none" (Standard) | "weekly" (weekdays: [1..7]) | "daily"
   *   until:  letztes Datum (optional), skipDates: ausgelassene Tage
   */
  function occursOn(ev, date) {
    if (!ev || !ev.date || !parseISO(date)) return false;
    const repeat = ev.repeat || "none";
    // einmalig – optional über mehrere Tage (endDate)
    if (repeat === "none") return ev.endDate && ev.endDate > ev.date ? date >= ev.date && date <= ev.endDate : ev.date === date;
    if (date < ev.date) return false;
    if (ev.until && date > ev.until) return false;
    if ((ev.skipDates || []).includes(date)) return false;
    if (repeat === "daily") return true;
    if (repeat === "weekly") {
      const days = (ev.weekdays && ev.weekdays.length) ? ev.weekdays.map(Number) : [isoWeekday(ev.date)];
      return days.includes(isoWeekday(date));
    }
    return false;
  }

  /** Alle Vorkommen an einem Tag – mit Erledigt-Status für genau diesen Tag. */
  function eventsOn(events, date) {
    return (events || []).filter((ev) => occursOn(ev, date)).map((ev) => ({
      ...ev,
      occurrence: date,
      spanDay: ev.endDate && ev.endDate > ev.date && (ev.repeat || "none") === "none" ? daysBetween(ev.date, date) + 1 : 0,
      spanDays: ev.endDate && ev.endDate > ev.date && (ev.repeat || "none") === "none" ? daysBetween(ev.date, ev.endDate) + 1 : 0,
      done: (ev.doneDates || []).includes(date) || (ev.repeat === "none" || !ev.repeat ? Boolean(ev.done) : false)
    }));
  }

  function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }

  /* ---------------- Abwesenheiten ----------------
     Urlaub, Krank, Berufsschule ersetzen an diesen Tagen die Routine:
       Urlaub         → Arbeit entfällt, Training (Gym/Lauf) bleibt
       Berufsschule   → Arbeit entfällt, Training bleibt
       Krank          → Arbeit, Gym und Lauf entfallen
       Krank          → zusätzlich keine Push-Erinnerungen */
  const ABSENCES = [
    { id: "vacation", name: "Urlaub", icon: "🌴", hides: ["work"], color: "#2fa3c7" },
    { id: "school", name: "Berufsschule", icon: "🎓", hides: ["work"], color: "#7a5af5" },
    { id: "sick", name: "Krank", icon: "🤒", hides: ["work", "training", "run"], color: "#d4483b", mutePush: true }
  ];
  const absenceKind = (id) => ABSENCES.find((a) => a.id === id) || ABSENCES[0];

  function absencesOn(events, date) {
    return eventsOn(events, date).filter((e) => e.type === "absence");
  }

  /**
   * Ereignisse eines Tages, so wie sie im Tagesplan erscheinen:
   * wiederkehrende Routine-Termine, die durch eine Abwesenheit entfallen, werden ausgeblendet.
   */
  function planEventsOn(events, date) {
    const all = eventsOn(events, date);
    const hidden = new Set(all.filter((e) => e.type === "absence").flatMap((e) => absenceKind(e.absence).hides));
    return all.filter((e) => !(hidden.has(e.type) && e.repeat && e.repeat !== "none"));
  }

  /** Push an diesem Tag stumm? (Krank oder Push-Pause bis zu einem Datum) */
  function pushMuted(events, settings, date) {
    const profile = (settings || []).find((s) => s.id === "profile") || {};
    if (profile.pushPausedUntil && date < profile.pushPausedUntil) return true;
    return absencesOn(events, date).some((e) => absenceKind(e.absence).mutePush);
  }

  function eventsBetween(events, from, to) {
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(...eventsOn(events, d));
    return out;
  }

  const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

  /** "jeden Mo, Di, Do, Fr" */
  function repeatLabel(ev) {
    if (!ev || !ev.repeat || ev.repeat === "none") return "";
    const until = ev.until ? ` bis ${ev.until.slice(8)}.${ev.until.slice(5, 7)}.` : "";
    if (ev.repeat === "daily") return `täglich${until}`;
    const days = (ev.weekdays && ev.weekdays.length ? ev.weekdays : [isoWeekday(ev.date)]).map(Number).sort();
    if (days.join() === "1,2,3,4,5") return `Mo–Fr${until}`;
    return `jeden ${days.map((d) => WEEKDAY_SHORT[d - 1]).join(", ")}${until}`;
  }

  /* ---------------- Training ---------------- */

  const MUSCLES = [
    { id: "chest", name: "Brust" },
    { id: "back", name: "Rücken" },
    { id: "shoulders", name: "Schultern" },
    { id: "biceps", name: "Bizeps" },
    { id: "triceps", name: "Trizeps" },
    { id: "forearms", name: "Unterarme" },
    { id: "abs", name: "Bauch" },
    { id: "glutes", name: "Gesäß" },
    { id: "quads", name: "Beinstrecker" },
    { id: "hamstrings", name: "Beinbeuger" },
    { id: "calves", name: "Waden" }
  ];

  const normName = (s) => String(s || "").trim().toLowerCase();

  /** Leistung eines Satzes: geschätztes 1RM (Epley) bzw. Wiederholungen ohne Gewicht. */
  function setPerformance(set) {
    const w = Number(set && set.weight) || 0;
    const r = Number(set && set.reps) || 0;
    if (r <= 0) return 0;
    return w > 0 ? w * (1 + r / 30) : r;
  }

  function sessionsBetween(sessions, from, to) {
    return (sessions || []).filter((s) => inRange(s.date, from, to));
  }

  /** Beste Leistung je Übung in einem Zeitraum: { name: { perf, label } } */
  function bestByExercise(sessions, from, to) {
    const best = {};
    sessionsBetween(sessions, from, to).forEach((s) => {
      (s.exercises || []).forEach((ex) => {
        const key = normName(ex.name);
        if (!key) return;
        (ex.sets || []).forEach((set) => {
          const perf = setPerformance(set);
          if (perf > 0 && (!best[key] || perf > best[key].perf)) {
            best[key] = { perf, name: ex.name, weight: Number(set.weight) || 0, reps: Number(set.reps) || 0 };
          }
        });
      });
    });
    return best;
  }

  /**
   * Kraftfortschritt pro Woche in %:
   * weeklyStrengthProgress = ((currentPerformance - previousPerformance) / previousPerformance) * 100
   * je Übung (beste Leistung der Woche vs. Vorwoche), gemittelt über alle vergleichbaren Übungen.
   */
  function weeklyStrengthProgress(sessions, ws) {
    const we = addDays(ws, 6);
    const current = bestByExercise(sessions, ws, we);
    const previous = bestByExercise(sessions, addDays(ws, -7), addDays(ws, -1));
    const details = Object.keys(current)
      .filter((k) => previous[k])
      .map((k) => {
        const pct = ((current[k].perf - previous[k].perf) / previous[k].perf) * 100;
        return { name: current[k].name, current: current[k], previous: previous[k], percent: Math.round(pct * 10) / 10 };
      });
    const percent = details.length ? Math.round((details.reduce((a, d) => a + d.percent, 0) / details.length) * 10) / 10 : null;
    return { percent, details };
  }

  /** Verlauf einer Übung: je Training bester Satz + Volumen. */
  function exerciseHistory(sessions, name) {
    const key = normName(name);
    return (sessions || [])
      .filter((s) => (s.exercises || []).some((e) => normName(e.name) === key))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => {
        const ex = s.exercises.find((e) => normName(e.name) === key);
        let best = null;
        let volume = 0;
        (ex.sets || []).forEach((set) => {
          volume += (Number(set.weight) || 0) * (Number(set.reps) || 0);
          if (!best || setPerformance(set) > setPerformance(best)) best = set;
        });
        return { date: s.date, sessionId: s.id, best, perf: best ? setPerformance(best) : 0, volume, sets: ex.sets || [] };
      });
  }

  /** Alle bisher trainierten Übungen (Name → Muskeln). */
  function knownExercises(sessions, plans) {
    const map = {};
    const add = (ex) => {
      const key = normName(ex.name);
      if (!key) return;
      if (!map[key]) map[key] = { name: ex.name.trim(), muscles: ex.muscles || [] };
      else if (!map[key].muscles.length && ex.muscles) map[key].muscles = ex.muscles;
    };
    (plans || []).forEach((p) => (p.exercises || []).forEach(add));
    (sessions || []).forEach((s) => (s.exercises || []).forEach(add));
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name, "de"));
  }

  /* Level wie in einem Videospiel: Schwelle für Level L = 60 · (L−1)^1.6 XP */
  const threshold = (level) => Math.round(60 * Math.pow(level - 1, 1.6));

  function levelFromXp(xp) {
    let level = 1;
    while (threshold(level + 1) <= xp) level++;
    const from = threshold(level);
    const to = threshold(level + 1);
    return { level, xp: Math.round(xp), from, to, progress: Math.min(1, (xp - from) / (to - from)) };
  }

  /**
   * Muskelgruppen-Fortschritt:
   *   10 XP pro Arbeitssatz für jede beteiligte Muskelgruppe,
   *   +25 XP für jede neue Bestleistung einer Übung.
   */
  function muscleProgress(sessions) {
    const xp = Object.fromEntries(MUSCLES.map((m) => [m.id, 0]));
    const best = {};
    [...(sessions || [])].sort((a, b) => a.date.localeCompare(b.date)).forEach((s) => {
      (s.exercises || []).forEach((ex) => {
        const muscles = (ex.muscles || []).filter((m) => m in xp);
        const key = normName(ex.name);
        let sessionBest = 0;
        (ex.sets || []).forEach((set) => {
          const perf = setPerformance(set);
          if (perf <= 0) return;
          muscles.forEach((m) => { xp[m] += 10; });
          sessionBest = Math.max(sessionBest, perf);
        });
        if (sessionBest > 0 && best[key] !== undefined && sessionBest > best[key]) muscles.forEach((m) => { xp[m] += 25; });
        if (sessionBest > 0) best[key] = Math.max(best[key] || 0, sessionBest);
      });
    });
    return MUSCLES.map((m) => ({ ...m, ...levelFromXp(xp[m.id]) }));
  }

  /** Ausdauer-Level: 10 XP pro Kilometer, +5 XP pro Lauf. */
  function enduranceProgress(runs) {
    const list = runs || [];
    const km = list.reduce((a, r) => a + (Number(r.distance) || 0), 0);
    return { ...levelFromXp(km * 10 + list.length * 5), km: Math.round(km * 10) / 10, runs: list.length };
  }

  /* ---------------- Rangsystem (Kraft) ----------------
     Richtwerte für das geschätzte Maximum (1RM) im Verhältnis zum Körpergewicht,
     angelehnt an gängige Kraftstandards für Männer (Einsteiger → Elite).
     Gold entspricht in etwa dem Niveau von Männern, die regelmäßig
     (1–2 Jahre, mehrmals pro Woche) trainieren.
     Bei Körpergewichtsübungen (Dips, Klimmzüge) zählt Körpergewicht + Zusatzgewicht. */

  const RANKS = [
    { id: "bronze", name: "Bronze", color: "#b0793e" },
    { id: "silver", name: "Silber", color: "#9ea3a8" },
    { id: "gold", name: "Gold", color: "#d4a72c" },
    { id: "platinum", name: "Platin", color: "#4fb3b0" },
    { id: "diamond", name: "Diamant", color: "#5b8def" },
    { id: "champion", name: "Champion", color: "#b05be0" }
  ];

  /* Schwellen = Beginn von Silber, Gold, Platin, Diamant, Champion (× Körpergewicht) */
  const STRENGTH_STANDARDS = [
    { id: "bench", name: "Bankdrücken", aliases: ["bankdrücken", "bankdruecken", "bench", "bench press", "flachbankdrücken"], muscles: ["chest", "triceps", "shoulders"], t: [0.75, 1.0, 1.5, 1.9, 2.25] },
    { id: "squat", name: "Kniebeuge", aliases: ["kniebeuge", "kniebeugen", "squat", "squats", "back squat"], muscles: ["quads", "glutes"], t: [1.0, 1.5, 2.0, 2.5, 3.0] },
    { id: "deadlift", name: "Kreuzheben", aliases: ["kreuzheben", "deadlift", "deadlifts"], muscles: ["back", "hamstrings", "glutes"], t: [1.25, 1.75, 2.25, 2.75, 3.25] },
    { id: "ohp", name: "Schulterdrücken", aliases: ["schulterdrücken", "schulterdruecken", "overhead press", "military press", "ohp", "schulterpresse"], muscles: ["shoulders", "triceps"], t: [0.5, 0.7, 0.95, 1.2, 1.45] },
    { id: "row", name: "Langhantelrudern", aliases: ["langhantelrudern", "rudern", "barbell row", "vorgebeugtes rudern", "bent over row"], muscles: ["back", "biceps"], t: [0.65, 0.9, 1.2, 1.55, 1.85] },
    { id: "pullup", name: "Klimmzüge", aliases: ["klimmzüge", "klimmzug", "klimmzuege", "pull-ups", "pull ups", "pullups", "chin-ups"], muscles: ["back", "biceps"], bodyweight: true, t: [1.1, 1.3, 1.6, 1.9, 2.15] },
    { id: "dips", name: "Dips", aliases: ["dips", "barrenstütz", "barrendips"], muscles: ["triceps", "chest"], bodyweight: true, t: [1.2, 1.45, 1.8, 2.15, 2.45] },
    { id: "curl", name: "Bizepscurls", aliases: ["bizepscurls", "bizepscurl", "langhantelcurls", "curls", "barbell curl", "sz-curls"], muscles: ["biceps", "forearms"], t: [0.4, 0.55, 0.75, 0.95, 1.15] },
    { id: "legpress", name: "Beinpresse", aliases: ["beinpresse", "leg press"], muscles: ["quads", "glutes"], t: [2.0, 2.75, 3.75, 4.75, 5.5] },
    { id: "calf", name: "Wadenheben", aliases: ["wadenheben", "calf raise", "calf raises"], muscles: ["calves"], t: [1.0, 1.5, 2.0, 2.6, 3.1] },
    { id: "abwheel", name: "Beinheben", aliases: ["beinheben", "hanging leg raise", "leg raises"], muscles: ["abs"], repsOnly: true, t: [8, 12, 18, 25, 32] }
  ];

  function standardFor(name) {
    const key = normName(name);
    return STRENGTH_STANDARDS.find((s) => s.aliases.includes(key)) || null;
  }

  /** Punktzahl → Rang (0–1 Bronze, 1–2 Silber, … 5+ Champion) mit Stufe III/II/I */
  function rankFromScore(score) {
    const idx = Math.max(0, Math.min(5, Math.floor(score)));
    const frac = idx === 5 ? 1 : score - idx;
    const division = idx === 5 ? "" : frac < 1 / 3 ? "III" : frac < 2 / 3 ? "II" : "I";
    return { ...RANKS[idx], index: idx, division, label: `${RANKS[idx].name}${division ? " " + division : ""}`, progress: idx === 5 ? 1 : frac, score, next: RANKS[idx + 1] || null };
  }

  /** Verhältniswert → Punktzahl über die Schwellen (stückweise linear). */
  function scoreFromRatio(ratio, t) {
    const edges = [0, ...t];
    if (ratio >= t[4]) return 5;
    for (let i = 0; i < 5; i++) {
      if (ratio < edges[i + 1]) {
        const from = i === 0 ? t[0] * 0.5 : edges[i];
        if (ratio <= from && i === 0) return 0;
        return i + (ratio - from) / (edges[i + 1] - from);
      }
    }
    return 5;
  }

  /**
   * Rang je Standard-Übung aus den Trainings der letzten 120 Tage (sonst Allzeit-Bestwert).
   * Ergebnis: [{ standard, best, ratio, rank, needed }]
   */
  function strengthRanks(sessions, bodyweight, refDate) {
    const bw = Number(bodyweight) || 0;
    if (!bw) return [];
    const from = refDate ? addDays(refDate, -120) : "0000-01-01";
    const out = [];
    STRENGTH_STANDARDS.forEach((std) => {
      let best = null;
      let bestScore = -1;
      let recent = false;
      (sessions || []).forEach((s) => (s.exercises || []).forEach((ex) => {
        if (!std.aliases.includes(normName(ex.name))) return;
        (ex.sets || []).forEach((set) => {
          const reps = Number(set.reps) || 0;
          if (reps <= 0) return;
          const w = Number(set.weight) || 0;
          const value = std.repsOnly ? reps : (std.bodyweight ? (bw + w) : w) * (1 + Math.min(reps, 15) / 30);
          const ratio = std.repsOnly ? value : value / bw;
          const isRecent = s.date >= from;
          const score = scoreFromRatio(ratio, std.t) + (isRecent ? 10 : 0); // aktuelle Werte bevorzugen
          if (score > bestScore) { bestScore = score; best = { date: s.date, weight: w, reps, ratio, name: ex.name }; recent = isRecent; }
        });
      }));
      if (!best) return;
      const rank = rankFromScore(scoreFromRatio(best.ratio, std.t));
      let needed = null;
      if (rank.next) {
        const target = std.t[rank.index];
        needed = std.repsOnly ? { reps: Math.ceil(target) } : { e1rm: Math.round((std.bodyweight ? target * bw - bw : target * bw) * 2) / 2 };
      }
      out.push({ standard: std, best, ratio: Math.round(best.ratio * 100) / 100, rank, recent, needed });
    });
    return out.sort((a, b) => b.rank.score - a.rank.score);
  }

  /** Rang je Muskelgruppe = bester Rang der Übungen, die sie trainieren. */
  function muscleRanks(exerciseRanks) {
    return MUSCLES.map((m) => {
      const hits = exerciseRanks.filter((r) => r.standard.muscles.includes(m.id));
      if (!hits.length) return { ...m, rank: null };
      const best = hits.reduce((a, b) => (b.rank.score > a.rank.score ? b : a));
      return { ...m, rank: best.rank, from: best.standard.name };
    });
  }

  function overallRank(exerciseRanks) {
    if (!exerciseRanks.length) return null;
    return rankFromScore(exerciseRanks.reduce((a, r) => a + r.rank.score, 0) / exerciseRanks.length);
  }

  /** Ausdauer-Rang: geschätzte 5-km-Zeit (Riegel) aus dem besten Lauf ≥ 3 km. */
  const RUN_5K_STANDARDS = [35 * 60, 29 * 60, 25 * 60, 22 * 60, 19 * 60]; // Beginn Silber … Champion
  function enduranceRank(runs) {
    let best = null;
    (runs || []).forEach((r) => {
      const d = Number(r.distance) || 0;
      const t = Number(r.duration) || 0;
      if (d < 3 || !t) return;
      const est = t * Math.pow(5 / d, 1.06);
      if (!best || est < best.time) best = { time: est, run: r };
    });
    if (!best) return null;
    const t = best.time;
    const edges = [45 * 60, ...RUN_5K_STANDARDS];
    let score = 5;
    for (let i = 0; i < 5; i++) {
      if (t > edges[i + 1]) { score = i + Math.max(0, (edges[i] - t) / (edges[i] - edges[i + 1])); break; }
    }
    const rank = rankFromScore(score);
    return { rank, est5k: Math.round(t), run: best.run, nextTime: rank.next ? RUN_5K_STANDARDS[rank.index] : null };
  }

  /* ---------------- Laufen ---------------- */

  /** "h:mm:ss" / "mm:ss" → Sekunden */
  function parseDuration(text) {
    const parts = String(text || "").trim().split(":").map((x) => Number(x));
    if (!parts.length || parts.some((x) => Number.isNaN(x))) return 0;
    return parts.reduce((acc, v) => acc * 60 + v, 0);
  }

  function formatDuration(seconds, withHours = true) {
    const s = Math.round(Number(seconds) || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return withHours || h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  }

  /** Pace (min/km) als "5:12" */
  function pace(distanceKm, durationSec) {
    const d = Number(distanceKm) || 0;
    if (d <= 0 || !durationSec) return "";
    const perKm = durationSec / d;
    return `${Math.floor(perKm / 60)}:${pad(Math.round(perKm % 60) % 60)}`;
  }

  /* ---------------- Ziele ---------------- */

  /**
   * Aktueller Wert eines Ziels. Ziele können mit anderen Bereichen verknüpft sein:
   *   link.type "manual"   – currentValue wird selbst gepflegt
   *   link.type "exercise" – höchstes Zusatzgewicht einer Übung bei ≥ link.reps Wiederholungen (Training)
   *   link.type "projects" – Anzahl abgeschlossener Projekte
   *   link.type "runs"     – gelaufene Kilometer seit link.since (bzw. Erstellung)
   */
  /** Übungsnamen tolerant vergleichen: „Dips“ = „dips “ = „Dip“ = „Dips (Brust)“ */
  const exKey = (s) => normName(s).replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss").replace(/\(.*?\)/g, "").replace(/[^a-zäöüß0-9]/g, "").replace(/(e?n|s|e)$/, "");
  function sameExercise(a, b) {
    const x = exKey(a), y = exKey(b);
    return Boolean(x && y) && (x === y || x.startsWith(y) || y.startsWith(x));
  }

  /** Aktuelles Körpergewicht: letzter Eintrag unter Körper, sonst Profil, sonst 75 kg. */
  function latestBodyweight(data) {
    const list = (data.bodyweight || []).filter((b) => Number(b.weight) > 0).sort((a, b) => a.date.localeCompare(b.date));
    if (list.length) return Number(list[list.length - 1].weight);
    const profile = (data.settings || []).find((x) => x.id === "profile") || {};
    return Number(profile.bodyweight) || 75;
  }

  /**
   * Übungs-Ziel. Auch Sätze mit weniger (oder mehr) Wiederholungen zählen:
   * über das geschätzte Maximum (Epley) wird umgerechnet, welches Gewicht
   * bei der Ziel-Wiederholungszahl möglich wäre. Bei Dips/Klimmzügen
   * wird das Körpergewicht mitgerechnet.
   */
  function exerciseGoalInfo(goal, data) {
    const link = goal.link || {};
    const minReps = Number(link.reps) || 1;
    const std = standardFor(link.exercise);
    const bw = std && std.bodyweight ? latestBodyweight(data) : 0;
    let current = 0, best = null, found = 0;
    (data.sessions || []).forEach((s) => (s.exercises || []).forEach((ex) => {
      if (!sameExercise(ex.name, link.exercise)) return;
      (ex.sets || []).forEach((set) => {
        const reps = Number(set.reps) || 0;
        const w = Number(String(set.weight ?? "").replace(",", ".")) || 0;
        if (!reps) return;
        found++;
        const equiv = reps === minReps ? w
          : ((bw + w) * (1 + Math.min(reps, 15) / 30)) / (1 + minReps / 30) - bw;
        const value = Math.max(0, Math.round(equiv * 10) / 10);
        if (value > current) { current = value; best = { weight: w, reps, date: s.date, equiv: value }; }
        else if (!best) best = { weight: w, reps, date: s.date, equiv: value };
      });
    }));
    return { current, best, found, minReps, bodyweight: bw };
  }

  function goalCurrent(goal, data) {
    const link = goal.link || { type: "manual" };
    if (link.type === "exercise") return exerciseGoalInfo(goal, data).current;
    if (link.type === "projects") {
      return (data.projects || []).filter((p) => p.status === "Abgeschlossen").length;
    }
    if (link.type === "runs") {
      const since = link.since || String(goal.createdAt || "").slice(0, 10) || "0000-01-01";
      return Math.round((data.runs || []).filter((r) => r.date >= since).reduce((a, r) => a + (Number(r.distance) || 0), 0) * 10) / 10;
    }
    return Number(goal.currentValue) || 0;
  }

  /** progress = (currentValue / targetValue) * 100 */
  function goalProgress(goal, data) {
    const current = goalCurrent(goal, data);
    const target = Number(goal.targetValue) || 0;
    const progress = target > 0 ? Math.max(0, Math.min(100, (current / target) * 100)) : 0;
    return { current, target, progress: Math.round(progress) };
  }

  /* ---------------- Tagebuch ---------------- */

  const RATINGS = [
    { key: "energy", label: "Energie" },
    { key: "focus", label: "Fokus" },
    { key: "mood", label: "Stimmung" },
    { key: "productivity", label: "Produktivität" },
    { key: "stress", label: "Stress" }
  ];

  const CLOSING_QUESTIONS = [
    { key: "gratitude", label: "Wofür bin ich heute dankbar?" },
    { key: "wentWell", label: "Was lief heute gut?" },
    { key: "wentBad", label: "Was lief heute schlecht?" },
    { key: "wouldChange", label: "Was hätte ich heute anders machen sollen?" },
    { key: "procrastinatedTask", label: "Welche Aufgabe habe ich unnötig aufgeschoben?" }
  ];

  /** Gilt der Tagesabschluss als ausgefüllt? */
  function closingDone(entry) {
    return Boolean(entry && entry.ratings && CLOSING_QUESTIONS.some((q) => String(entry[q.key] || "").trim()));
  }

  /* ---------------- Wochenfeedback ---------------- */

  const avg = (list) => (list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : null);

  /**
   * Alle relevanten Daten einer Woche (Mo–So) zusammenführen:
   * WeeklyContext { journalEntries, dailyRatings, workouts, sleep, runs, todos, calendarEvents, projects, goals }
   */
  function buildWeeklyContext(data, ws, followups = []) {
    const we = addDays(ws, 6);
    const entries = (data.entries || []).filter((e) => inRange(e.date, ws, we)).sort((a, b) => a.date.localeCompare(b.date));
    const sessions = sessionsBetween(data.sessions, ws, we).sort((a, b) => a.date.localeCompare(b.date));
    const sleep = (data.sleep || []).filter((s) => inRange(s.date, ws, we)).sort((a, b) => a.date.localeCompare(b.date));
    const runs = (data.runs || []).filter((r) => inRange(r.date, ws, we)).sort((a, b) => a.date.localeCompare(b.date));
    const todos = (data.todos || []).filter((t) => inRange(t.date, ws, we));
    const events = eventsBetween(data.events, ws, we).sort((a, b) => (a.occurrence + (a.start || "")).localeCompare(b.occurrence + (b.start || "")));
    const tagName = (id) => ((data.tags || []).find((t) => t.id === id) || {}).name || "";
    const strength = weeklyStrengthProgress(data.sessions, ws);

    const ratingAverages = {};
    RATINGS.forEach((r) => {
      ratingAverages[r.key] = avg(entries.filter((e) => e.ratings && e.ratings[r.key]).map((e) => Number(e.ratings[r.key])));
    });

    return {
      week: { start: ws, end: we },
      journalEntries: entries.map((e) => ({
        date: e.date,
        journal: e.journal || "",
        gratitude: e.gratitude || "",
        wentWell: e.wentWell || "",
        wentBad: e.wentBad || "",
        wouldChange: e.wouldChange || "",
        procrastinatedTask: e.procrastinatedTask || ""
      })),
      dailyRatings: {
        perDay: entries.filter((e) => e.ratings).map((e) => ({ date: e.date, ...e.ratings })),
        averages: ratingAverages,
        daysWithClosing: entries.filter(closingDone).length
      },
      workouts: {
        sessions: sessions.map((s) => ({
          date: s.date,
          name: s.name || "",
          durationMin: s.durationMin || null,
          exercises: (s.exercises || []).map((ex) => ({
            name: ex.name,
            sets: (ex.sets || []).map((set) => `${set.weight || 0} kg × ${set.reps || 0}`).join(", ")
          }))
        })),
        weeklyStrengthProgressPercent: strength.percent,
        strengthDetails: strength.details.map((d) => ({ exercise: d.name, percent: d.percent }))
      },
      sleep: {
        nights: sleep,
        averageDurationMin: avg(sleep.map((s) => Number(s.sleepDuration) || 0).filter(Boolean)),
        averageScore: avg(sleep.map((s) => Number(s.sleepScore) || 0).filter(Boolean))
      },
      runs: {
        list: runs.map((r) => ({ date: r.date, distanceKm: r.distance, duration: formatDuration(r.duration), pace: r.pace || pace(r.distance, r.duration) })),
        totalKm: Math.round(runs.reduce((a, r) => a + (Number(r.distance) || 0), 0) * 10) / 10
      },
      todos: {
        total: todos.length,
        completed: todos.filter((t) => t.completed).length,
        open: todos.filter((t) => !t.completed).map((t) => ({ title: t.title, date: t.date, tag: tagName(t.tagId) })),
        done: todos.filter((t) => t.completed).map((t) => ({ title: t.title, date: t.date, tag: tagName(t.tagId) }))
      },
      calendarEvents: events.map((e) => ({
        date: e.occurrence, type: e.type, title: e.title, start: e.start || "", end: e.end || "",
        location: e.location || "", department: e.department || "", done: e.done, recurring: repeatLabel(e)
      })).concat(followups.filter((f) => inRange(f.date, ws, we)).map((f) => ({
        date: f.date, type: "followup", title: `${f.kind === "call" ? "Anruf" : "Follow-up"}: ${f.company}`
      }))),
      strengthRanks: (() => {
        const profile = (data.settings || []).find((x) => x.id === "profile") || {};
        const ranks = strengthRanks(data.sessions, profile.bodyweight, we);
        const overall = overallRank(ranks);
        return { overall: overall ? overall.label : null, exercises: ranks.map((r) => ({ exercise: r.standard.name, rank: r.rank.label, ratioToBodyweight: r.ratio })) };
      })(),
      bodyweight: (() => {
        const all = (data.bodyweight || []).filter((b) => Number(b.weight) > 0).sort((a, b) => a.date.localeCompare(b.date));
        const week = all.filter((b) => inRange(b.date, ws, we));
        const before = all.filter((b) => b.date < ws).pop();
        const last = week[week.length - 1];
        return {
          entries: week.map((b) => ({ date: b.date, kg: b.weight })),
          changeVsLastWeekKg: last && before ? Math.round((last.weight - before.weight) * 10) / 10 : null,
          progressPhotosThisWeek: (data.photos || []).filter((p) => inRange(p.date, ws, we)).length
        };
      })(),
      projects: (data.projects || []).map((p) => ({ title: p.title, status: p.status, progress: p.progress, notes: p.notes || "" })),
      goals: (data.goals || []).map((g) => {
        const gp = goalProgress(g, data);
        return { title: g.title, current: gp.current, target: gp.target, unit: g.unit || "", progressPercent: gp.progress, deadline: g.deadline || "" };
      })
    };
  }

  /** Auftrag an Claude für das Wochenfeedback. */
  function buildFeedbackPrompt(context) {
    return [
      "Du bist mein persönlicher Coach. Unten stehen alle gespeicherten Daten meiner Woche",
      `(${context.week.start} bis ${context.week.end}) aus meinem Tagebuch und Life-Management-System als JSON.`,
      "",
      "Erstelle daraus ein persönliches Wochenfeedback auf Deutsch. Fokus:",
      "1. Effizienz steigern",
      "2. Wiederkehrende Probleme erkennen",
      "3. Aufschieben erkennen (besonders: aufgeschobene Aufgaben, offene To-dos)",
      "4. Routinen optimieren (Schlaf, Training, Laufen, Arbeitszeiten)",
      "5. Positive Muster erkennen",
      "6. Zielerreichung wahrscheinlicher machen (Ziele, Projekte, Trainingsfortschritt)",
      "",
      "Regeln: Beziehe jeden Punkt konkret auf die Daten dieser Woche (Tage, Werte, Einträge nennen).",
      "Erfinde nichts. Wenn Daten fehlen, sag kurz, was fehlt.",
      "Gliederung: kurze Zusammenfassung, dann die sechs Punkte mit Überschriften,",
      "zum Schluss maximal 3 konkrete Vorhaben für nächste Woche. Kurz und klar, Markdown.",
      "",
      "DATEN:",
      JSON.stringify(context, null, 1)
    ].join("\n");
  }

  root.LifeModel = {
    pad, parseISO, toISO, addDays, nowInGermany, weekStart, inRange, isoWeekday,
    occursOn, eventsOn, eventsBetween, repeatLabel, WEEKDAY_SHORT, daysBetween,
    ABSENCES, absenceKind, absencesOn, planEventsOn, pushMuted,
    RANKS, STRENGTH_STANDARDS, standardFor, rankFromScore, strengthRanks, muscleRanks, overallRank, enduranceRank,
    MUSCLES, setPerformance, bestByExercise, weeklyStrengthProgress, exerciseHistory, knownExercises,
    levelFromXp, muscleProgress, enduranceProgress,
    parseDuration, formatDuration, pace,
    goalCurrent, goalProgress, exerciseGoalInfo,
    RATINGS, CLOSING_QUESTIONS, closingDone,
    buildWeeklyContext, buildFeedbackPrompt
  };
})(typeof window !== "undefined" ? window : globalThis);
