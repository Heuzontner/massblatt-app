# Maßblatt – VIEWPORT 360°

Web-App (Android/Chrome, läuft auch am iPhone) für das Aufmaß vor Ort mit dem Bosch GLM 50-27 C über Bluetooth.
Erzeugt ein Maßblatt-PDF im Aufbau des Bosch-Measuring-Master-Exports (lesbar für FloorplanAI / RBEM-TUEREN).

- Foto → Pfeile für Höhe/Breite (Vorlage oder mit dem Finger aufziehen) → Laser drücken → nächster Pfeil → nächstes Foto
- Reihenfolge wie bei Bosch: Fenster links→rechts (Höhe, Breite), dann Tür (Höhe, Breite)
- Offline; Daten bleiben am Handy (Export/Import, Dropbox, Mail, Google-Kalender optional)
- KI-Erkennung von Tür/Fenster ist vorbereitet (OWL-ViT), derzeit standardmäßig aus

Installation: Seite in Chrome öffnen → Menü ⋮ → „App installieren“ / „Zum Startbildschirm“.

## Tests
`test/` (nicht im Repo): Playwright-Läufe mit System-Chrome gegen `python3 -m http.server 8766` im Repo-Ordner
(`full.py` = Gesamtablauf, `full2.py` = Einstellungen/Sonderfälle).
