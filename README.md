# luma Creator Studio

## Lokal starten

1. `.env.example` kopieren und die Kopie `.env` nennen.
2. In `.env` die Twitch-Client-ID und das Twitch-Client-Secret eintragen. Das Client-Secret bleibt auf dem Server und darf nicht in `index.html` oder in einen öffentlichen Chat kopiert werden.
3. Für lokale Twitch-Anmeldungen `TWITCH_REDIRECT_URI` in `.env` auf `http://localhost:3000/auth/twitch/callback` setzen und dieselbe URL in der Twitch-Entwicklerkonsole eintragen.
4. Im Projektordner `node server.mjs` ausführen und `http://localhost:3000` öffnen.

## Auf luma.blocknova.de bereitstellen

Die Domain muss auf einen Server oder Hostingdienst zeigen, auf dem diese Node.js-Anwendung läuft. Für `luma.blocknova.de` ist die Twitch-Redirect-URL:

`https://luma.blocknova.de/auth/twitch/callback`

Trage diese URL exakt in der Twitch-Entwicklerkonsole ein und setze sie als `TWITCH_REDIRECT_URI` in der Produktionsumgebung. Hinterlege dort außerdem `TWITCH_CLIENT_ID` und `TWITCH_CLIENT_SECRET`; nutze dafür nicht die öffentlichen Dateien des Projekts. Der Server lauscht standardmäßig auf `0.0.0.0:3000`; `HOST` und `PORT` können vom Hostingdienst vorgegeben werden. Richte HTTPS und eine Weiterleitung vom Hosting-Proxy an den Node.js-Port ein.

Wenn die Domain `502 Bad Gateway` anzeigt, erreicht ihr Proxy derzeit keine laufende Anwendung. Starte/deploye den Node.js-Server beim Hostinganbieter und prüfe dessen Proxy-/Port-Einstellung. Nur die Domain und die Redirect-URL zu setzen veröffentlicht die Website noch nicht.

Der Server nutzt Twitch OAuth Authorization Code Flow, prüft den OAuth-Status und hält das Zugriffstoken serverseitig im Arbeitsspeicher. Die Anmeldung wird beim Neustart des Servers beendet. Es werden keine weiteren Twitch-Berechtigungen angefordert.
