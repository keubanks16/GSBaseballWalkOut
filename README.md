# GS Baseball Walkout Songs

A BallparkDJ-style walkout (walk-up) song app for GS Baseball. Runs in the browser, installs to the Home Screen, and works offline at the field.

- **Roster:** each player gets a song from your Files app, a start point, play length, fade out and volume
- **Announcer:** built-in announcer voice ("Now batting, number 7, MJ Eubanks!"), your own recorded voice with stadium echo, or none, with an option to play music under the announcement
- **Game mode:** big "Next up" button that walks through the batting order, tap any player or bench player, fade and stop
- **Sounds:** Charge!, air horn, claps, rally organ, plus your own clips
- **Multiple teams**, plus a backup file to move everything to another phone

All songs stay on the device (IndexedDB); nothing is uploaded.

## Pro announcer (Cloudflare)

The pro announcer uses ElevenLabs v3 through Cloudflare AI Gateway (paid with AI Gateway credits — no ElevenLabs account needed), with a "Basic" fallback on Workers AI (Deepgram Aura-2). Audio runs through a stadium P.A. effect on the phone. Each player's announcement is made once and saved on the device, so games work with no signal.

Deploy: Cloudflare dashboard → Workers & Pages → Create → Import a repository → `GSBaseballWalkOut` → Deploy. `wrangler.jsonc` sets up the app files and the AI binding. The app is then at `https://gsbaseballwalkout.<your-subdomain>.workers.dev`.
If you open the app from GitHub Pages instead, paste that workers.dev address into Settings → Announcer server.
