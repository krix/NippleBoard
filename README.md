# TV Total NippleBoard (PWA)

Lokale, offlinefähige Progressive Web App im „TV Total NippleBoard“-Stil: ein Raster aus Buttons mit Vorschaubild und Titel, das beim Tippen kurze Videoclips abspielt.

## Funktionen
- Responsives Button-Raster mit großen Touch-Zielen
- Wiedergabe direkt im geklickten Button (ohne Overlay, ohne Videosteuerung/Pause/Vor-zurück); Tippen während der Wiedergabe oder `ESC` stoppt den Clip, am Ende wird das Vorschaubild wiederhergestellt
- Bearbeiten-Modus: Titel ändern, eigenes Bild hochladen (auf max. 400×400 px skaliert), Frame aus Video wählen, automatisches Vorschaubild zurücksetzen, Buttons ausblenden/einblenden, Reihenfolge per Drag & Drop (Maus & Touch)
- Persistenz in IndexedDB (Fallback: localStorage mit Hinweis, ohne Bild-Blobs)
- Export/Import der Einstellungen als JSON (Bilder als Base64)
- Suche/Filter nach Titel
- PWA: installierbar, Offline-Betrieb via Service Worker, Caching-Fortschritt beim ersten Laden der Clips

## Projektstruktur
```
index.html
style.css
app.js
sw.js
manifest.webmanifest
clips.json
generate_clips_json.py
generate_clips_json.js
clips/              (Videodateien: .mp4, .webm, .mov)
icons/              (App-Icons)
README.md
```

## Lokaler Start
Service Worker funktionieren nur über `http://localhost` oder HTTPS (nicht über `file://`).

1. Im Projektordner einen lokalen Server starten:
   - Python: `python -m http.server 8000`
   - oder Node: `npx serve .`
2. Im Browser öffnen: `http://localhost:8000`
3. App über den Browser installieren (Installieren-Button / Browser-Menü „App installieren“).
4. Nach der Installation und dem ersten vollständigen Caching funktioniert die App offline und ohne laufenden Server.

### Nutzung im lokalen Netzwerk (Handy)
Damit ein anderes Gerät im LAN zugreifen kann, muss der Server im Netzwerk erreichbar sein (z. B. `python -m http.server 8000 --bind 0.0.0.0`). **Wichtig:** Service Worker und Installation erfordern in der Regel einen sicheren Kontext. `localhost` ist sicher, eine reine HTTP-IP-Adresse im LAN meist nicht. Für echte PWA-Installation/Offline-Nutzung auf dem Handy nutze HTTPS (z. B. über einen lokalen Reverse-Proxy mit Zertifikat) oder teste die Installation direkt auf dem Gerät über localhost (z. B. Port-Forwarding/USB-Debugging). Als Fallback kann die Seite im Browser genutzt werden, Offline-Funktionen sind dann ggf. eingeschränkt.

## Clips hinzufügen
- Lege Videodateien in den Ordner `clips/` (unterstützt: `.mp4` H.264/AAC, `.webm`, `.mov`).
- Aktualisiere `clips.json` automatisch, ohne vorhandene Titel/Bilder-Einträge zu überschreiben:
  - Python: `python generate_clips_json.py`
  - Node: `node generate_clips_json.js`
- Die App lädt `clips.json` per Network-first (mit Cache-Fallback), neue Einträge erscheinen automatisch.

`clips.json`-Format (Beispiel):
```json
[
  { "id": "clip1", "file": "clips/clip1.mp4", "title": "Clip 1", "image": null },
  { "id": "clip2", "file": "clips/clip2.mp4", "title": "Clip 2", "image": null },
  { "id": "clip3", "file": "clips/clip3.mp4", "title": "Clip 3", "image": null }
]
```
Im Projekt sind bereits reale Clip-Dateien in `clips/` vorhanden und in `clips.json` eingetragen (mehr als 3). Um das geforderte Beispiel zu sehen, können obige Einträge als Muster dienen; eigene Clips einfach nach `clips/` kopieren und das Generatorskript ausführen.

## Bearbeiten-Modus
- Umschalter „Bearbeiten“ in der Kopfzeile aktivieren.
- Tippen auf einen Button öffnet den Editor (statt Wiedergabe): Titel, Bild, Sichtbarkeit.
- Bild: eigene Datei wählen, Frame aus Video per Slider übernehmen oder auf automatisches Vorschaubild zurücksetzen.
- Reihenfolge per Drag & Drop ändern (auch Touch). Ausgeblendete Buttons sind im Bearbeiten-Modus sichtbar markiert.

## Backup / Import
- „Menü“ → „Einstellungen exportieren“ erzeugt eine JSON-Datei (inkl. Bilder als Base64).
- „Einstellungen importieren“ stellt Titel, Bilder, Reihenfolge, Sichtbarkeit etc. aus einer solchen Datei wieder her.
- `clips.json` liefert nur Grundwerte; lokale Änderungen haben Vorrang. Neue in `clips.json` auftauchende Clips werden automatisch ergänzt.

## Hinweise
- Die App fragt nach Möglichkeit `navigator.storage.persist()` an, um Datenverlust bei Speicherknappheit zu reduzieren.
- iOS: Installation über „Teilen“ → „Zum Home-Bildschirm“. Safari behandelt Video-Range-Requests im Cache speziell – der Service Worker erzeugt dafür 206-Antworten.
- Wenn eine Clipdatei fehlt/defekt ist, zeigt die App eine Fehlermeldung und das Raster bleibt nutzbar.

## Checkliste: Offline-Betrieb testen
1. **Erststart online:** Server starten, `http://localhost:8000` öffnen. Warten, bis „Lade Clips für Offline-Nutzung: x/y“ abgeschlossen ist.
2. **Service Worker prüfen:** DevTools → Application → Service Workers: Worker aktiv/kontrollierend; Application → Cache Storage: `nippleboard-…` enthält App-Shell und Dateien aus `clips/`.
3. **Offline simulieren:** DevTools → Network → „Offline“ aktivieren **oder** Flugmodus einschalten. Seite neu laden (F5) – App sollte vollständig laden.
4. **Wiedergabe offline:** Mehrere Clips antippen; Wiedergabe im Button testen (Range-Requests aus Cache).
5. **clips.json-Fallback:** Bei Offline sollte die zuletzt gecachte `clips.json` verwendet werden.
6. **Persistenz:** Titel/Bild/Reihenfolge ändern, Seite neu laden (weiterhin offline) – Änderungen müssen erhalten bleiben.
7. **Installation:** App installieren, Server beenden/Offline gehen, installierte App starten – Funktion wie oben.
8. **Optional Speicher:** DevTools → Application → Storage auf Persistenz/Quota prüfen.
