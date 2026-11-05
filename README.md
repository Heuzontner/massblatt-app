# Maßblatt – VIEWPORT 360°

Web-App (Android, Chrome) für das Aufmaß vor Ort mit dem Bosch GLM 50-27 C über Bluetooth.
Erzeugt ein Maßblatt-PDF im Aufbau des Bosch-Measuring-Master-Exports (lesbar für FloorplanAI / RBEM-TUEREN).

- Foto → KI legt Pfeile auf Tür/Fenster (Höhe, Breite) → Laser drücken → nächster Pfeil → nächstes Foto
- Reihenfolge: Fenster links→rechts (Höhe, Breite), dann Tür (Höhe, Breite)
- Offline; Daten bleiben am Handy. KI-Modell (OWL-ViT, ~150 MB) wird beim ersten Mal geladen.

Installation: Seite in Chrome öffnen → Menü ⋮ → „App installieren“ / „Zum Startbildschirm“.
