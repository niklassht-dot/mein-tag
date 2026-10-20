# Mein Tag

Persönliches Tagebuch und Life-Management-System als installierbare Web-App (PWA).
Die Daten werden auf Netlify gespeichert und zwischen Handy und Rechner synchronisiert. Geschützt ist alles mit einem PIN (Standard: **2109**).

## Bereiche

- **Heute (Tagesplan):** Alles für den Tag als abhakbare Boxen, zum Beispiel Arbeit 08:15–16:15, Gym, Lauf, Termine und To-dos.
  - Termine mit Uhrzeit nehmen so viel Platz ein, wie sie dauern. Eine rote Linie zeigt die aktuelle Uhrzeit.
  - Darunter stehen Schlaf und Tagebuch. Die Lead-Follow-ups sind klein und aufklappbar ganz unten.
- **Tagebuch + Tagesabschluss:** fünf Fragen und fünf Bewertungen (Slider 1–10). Um 21:15 Uhr kommt eine Push-Erinnerung, solange der Abschluss noch nicht ausgefüllt ist.
- **Kalender:** Termine, Arbeitszeiten, Gym und Läufe, auch **wiederkehrend**: wöchentlich an bestimmten Tagen oder täglich, optional mit Enddatum. Einzelne Tage lassen sich auslassen.
  - Startroutine: Arbeit Mo–Fr 08:15–16:15, Lauf Mi und Sa, Gym Mo/Di/Do/Fr. Alles lässt sich ändern.
  - Dazu kommen To-dos und Lead-Follow-ups (aus https://leadsaufwind.netlify.app).
- **To-dos:** Tags mit eigenen Namen und Farben, sortierbar nach Tag
- **Training:**
  - Trainingspläne anlegen und Trainings als Logbuch dokumentieren
  - **Timer:** Die Gesamtzeit läuft ab dem Start. Nach jedem eingetragenen Satz startet ein Pausen-Timer, der bis zum nächsten Satz läuft. Die Pause wird pro Satz gespeichert, beide Zeiten laufen auch in der Dynamic Island mit.
  - Kraftfortschritt pro Woche in %
  - Übungen über die Zeit vergleichen
  - **Rangsystem** Bronze → Silber → Gold → Platin → Diamant → Champion, jeweils mit den Stufen III/II/I
  - Maßstab ist das geschätzte Maximum im Verhältnis zum Körpergewicht, verglichen mit Kraftwerten von Männern. Gold entspricht in etwa regelmäßig trainierenden Männern.
  - Körperabbildung in Rangfarben und ein Ausdauer-Rang über die geschätzte 5-km-Zeit
- **Ziele:** Fortschrittsbalken. Ziele können automatisch mitwachsen, zum Beispiel aus einer Übung („Dips +50 kg für 8 Wdh.“), aus abgeschlossenen Projekten oder aus gelaufenen Kilometern.
- **Projekte:** Status, Fortschritt und aktueller Stand
- **Körper:** Gewicht eintragen, Verlauf mit 7-Tage-Durchschnitt und Veränderung über 7 und 30 Tage. Das aktuelle Gewicht fließt in die Trainings-Ränge ein.
  - **Fortschrittsfotos** (vorne, seitlich, hinten) mit Vorher/Nachher-Vergleich nebeneinander, nur mit PIN sichtbar
- **Schlaf:** manuell eintragen oder den Zepp-Export (SLEEP_….csv) importieren
- **Laufen:** Strava-Link einfügen, dann werden Datum, Distanz, Zeit und Pace automatisch übernommen. Auf Knopfdruck holst du die Läufe der letzten 30 Tage. Dazu ein eigener Laufplan.
- **Brainstorm:** Ideen als Text und eine freie Zeichenfläche
- **Wochenfeedback:** Sonntags werden alle Daten der Woche zusammengefasst, und Claude erstellt daraus ein persönliches Feedback.

Navigiert wird über die **Dynamic Island** oben: Ein Tipp auf den Pfeil öffnet alle Bereiche und die Schnellaktionen.

## Einmalig veröffentlichen (eigene Netlify-Seite)

```bash
cd ~/Downloads && unzip -o mein-tag.zip && cd mein-tag && npm install
npx netlify-cli sites:create
npx netlify-cli deploy --prod
```

Bei `sites:create` wählst du dein Team und einen Namen, zum Beispiel `mein-tag-niklas`. Die Seite ist danach unter `https://<name>.netlify.app` erreichbar.
Für spätere Updates reicht `npx netlify-cli deploy --prod`.

## Aufs Handy

- **iPhone:** Seite in Safari öffnen → **Teilen → Zum Home-Bildschirm**. Dann die App „Mein Tag“ öffnen und **🔔 Push aktivieren** → **Erlauben** tippen.
- **Android:** Seite in Chrome öffnen → Menü → **Zum Startbildschirm hinzufügen** → 🔔 tippen → **Erlauben**.

## Einstellungen (optional)

Unter Netlify → *Site configuration → Environment variables*. Nach einer Änderung einmal neu deployen.

| Variable | Wofür |
|---|---|
| `ANTHROPIC_API_KEY` | Automatisches Wochenfeedback mit Claude (Schlüssel von console.anthropic.com). Ohne Schlüssel gibt es den fertigen Auftrag zum Kopieren in claude.ai. |
| `CLAUDE_MODEL` | Modell fürs Feedback, Standard `claude-sonnet-5-5` |
| `LIFE_PIN` | Eigener PIN statt 2109 |
| `LEADS_PIN` | Nur nötig, wenn du den PIN der Lead-Liste änderst |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | Strava-Verbindung (siehe unten) |

## Strava (einmalig, ca. 3 Minuten)

Ohne Einrichtung liest die App nur **öffentliche** Aktivitäten aus dem Link aus. Für private Läufe und den Import:

1. https://www.strava.com/settings/api öffnen und eine App anlegen:
   - **Name:** Mein Tag
   - **Kategorie:** Training
   - **Website:** `https://<name>.netlify.app`
   - **Authorization Callback Domain:** genau die Adresse, unter der du die App öffnest, zum Beispiel `mein-tag-niklas.netlify.app`. Ohne `https://`, ohne `/` am Ende und ohne Pfad. Die App zeigt dir unter Laufen die richtige Domain zum Kopieren an.
   - Erscheint die Meldung `redirect_uri invalid`, stimmt diese Domain nicht mit der Adresse der App überein.
2. Client ID und Client Secret im Projektordner eintragen und neu deployen:
   ```bash
   npx netlify-cli env:set STRAVA_CLIENT_ID 12345
   npx netlify-cli env:set STRAVA_CLIENT_SECRET dein-secret
   npx netlify-cli deploy --prod
   ```
3. In der App unter **Laufen → Strava verbinden** tippen und bei Strava auf **Autorisieren** tippen.

Danach werden Werte aus jedem Strava-Link übernommen. „Neue Läufe holen“ importiert deine Läufe der letzten 30 Tage, ohne doppelte Einträge.

## Benachrichtigungen

- **21:15 Uhr:** Tagesabschluss (nur, wenn er noch offen ist)
- **30 Minuten vorher:** Termine und geplante Trainings mit Uhrzeit (pro Termin abschaltbar)
- **8:00 Uhr:** die heutigen offenen To-dos
- **Sonntag ab 19 Uhr:** „Dein Wochenfeedback ist da“ (mit Claude-Schlüssel)

Lead-Follow-ups meldet weiterhin die Lead-Liste selbst.

## Grenzen

- **Strava ohne Verbindung:** Nur öffentliche Aktivitäten lassen sich aus dem Link lesen, und auch das nur, solange Strava die Seite so ausliefert. Mit Verbindung läuft alles über die offizielle Strava-API.
- **Zepp:** Es gibt keine offene Schnittstelle. Deshalb läuft der Import über den CSV-Export der Zepp-App. Der Schlafwert ist darin nicht enthalten und kann von Hand ergänzt werden.
