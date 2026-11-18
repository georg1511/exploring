# Exploring 🧭

Web- & Handy-App (PWA), die einlädt, eine Stadt zu entdecken – gemacht für den Abend auf Dienstreise:
App auf, Zeit wählen, loslaufen.

## Starten

```powershell
node server.js
```

Dann <http://localhost:5173> öffnen. Ohne GPS (z. B. am Desktop) zum Ausprobieren:
<http://localhost:5173/?sim=48.1374,11.5755> – simuliert Standort und Bewegung (10× schneller).

## Funktionen

- **Runde** ab Standort oder **Von A nach B** (Ziel suchen oder auf Karte tippen; langes Drücken = Startpunkt)
- Modi **Gehen, Laufen, Rad, Auto** – eigenes Tempo einstellbar
- Interessen: Kultur, Natur, Verrückt, Architektur, Aussicht, Genuss – oder **✨ Überrasch mich**
- **Zeitbudget**: Route wird auf deine Minuten zugeschnitten; ist A→B schon direkt länger, sagt die App das
- **Entdeckungen** gleichmäßig über die Strecke verteilt, mit Bild und Wikipedia-Text
- **Fahrten von A nach B**: zeigt die direkte Fahrzeit, du wählst die Extra-Zeit (+10 … +60 Min) und bekommst
  bekannte Stopps entlang der Strecke (Schlösser, Klöster, Seen …)
  inklusive Zeit vor Ort (Stopp-Dauer einstellbar)
- **Orte abwählen oder festlegen**: in der Ortsansicht „Nicht für mich“ / „Unbedingt hin“ – die Route plant neu
- **Hotel merken** (🏨 im Startfeld): ein Tipp setzt den Start künftig dorthin
- **Tracker wie eine Sport-App**: Zeit, Distanz, Ø- und aktuelles Tempo, kcal, Höhenmeter, Kilometer-Zeiten,
  Auto-Pause; meldet Orte, wenn du vorbeikommst
- **Auswertung** nach jeder Aktivität: Höhenprofil, Kilometer-Zeiten, entdeckte Orte, GPX-Export, „Als Route merken“
- **Meine Wege**: Aktivitäten, gemerkte Routen und Statistik (Wochenziel, 8-Wochen-Verlauf, Bestleistungen,
  Summen je Sportart); bisherige Wege lila auf der Karte und Anzeige, wie viel % einer Route neu für dich ist

- **Motivation**: XP und Level, 17 Abzeichen, drei Wochen-Challenges; jede Route zeigt, wie viele neue Orte und XP sie bringt
- **Design** nach iOS-Richtlinien: Systemschrift, eigene Linien-Icons (keine Emojis), heller und dunkler Modus
- **Darstellung wählbar** (Ebenen-Knopf rechts oben): Karte als Standard, Satellit, Gelände oder Rad;
  sechs Akzentfarben; eigene Wege ein- oder ausblenden

Daten bleiben lokal im Browser (localStorage).

## Datenquellen (kostenlos, ohne API-Key)

OpenStreetMap-Karte · Routing: FOSSGIS OSRM (routing.openstreetmap.de) · Orte: Overpass API + Wikipedia ·
Suche: Nominatim. Fällt Overpass aus, arbeitet die App nur mit Wikipedia-Orten weiter.

## Aufs Handy

GPS funktioniert im Browser nur über **HTTPS**. Ordner z. B. auf GitHub Pages, Netlify oder Cloudflare Pages
hochladen, Seite am Handy öffnen und „Zum Home-Bildschirm“ wählen.
