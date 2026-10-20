# luma Creator Studio

## Twitch-Anmeldung lokal aktivieren

1. In der Twitch-Entwicklerkonsole muss diese Redirect-URL exakt eingetragen sein:

   `http://localhost:3000/auth/twitch/callback`

2. `.env.example` kopieren und die Kopie `.env` nennen.
3. In `.env` die Twitch-Client-ID und das Twitch-Client-Secret eintragen. Das Client-Secret bleibt auf dem Server und darf nicht in `index.html` oder in einen öffentlichen Chat kopiert werden.
4. Im Projektordner `node server.mjs` ausführen.
5. `http://localhost:3000` im Browser öffnen und **Mit Twitch verbinden** auswählen.

Der lokale Demo-Server nutzt Twitch OAuth Authorization Code Flow, prüft den OAuth-Status und hält das Zugriffstoken serverseitig im Arbeitsspeicher. Die Anmeldung wird beim Neustart des Servers beendet. Es werden keine weiteren Twitch-Berechtigungen angefordert.
