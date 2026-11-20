# EscapeAI prototype

Node.js, no dependencies. Storage is a single `data.json` file next to `server.js`.

## Run

```bash
ADMIN_PASSWORD='something-long' PORT=3000 LIVE_URL=https://live.example.org node server.js
```

Local testing without subdomains:

- Dashboard: http://localhost:3000/
- Teacher admin: http://localhost:3000/admin (password from `ADMIN_PASSWORD`)
- Player page: http://localhost:3000/live?c=c-lab-drawer

## Domains

Point `admin.<domain>`, `live.<domain>` and `<domain>` at the same server (DNS + reverse proxy such as nginx). The server picks the page from the Host header. `LIVE_URL` must be the public live address, because the QR codes in the admin page are built from it.

## Pages

- `admin.<domain>`: teachers log in and create, edit and delete challenges. Each challenge gets a QR code that links to `live.<domain>/?c=<id>`.
- `live.<domain>`: player flow. Description and materials, then GO starts the stopwatch, then STOP and a 1–5 enjoyment rating with an optional comment.
- `<domain>`: public dashboard with per-challenge attempts, best and average time, and average enjoyment. Refreshes every 15 s.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/challenges` | public |
| GET | `/api/stats` | public |
| POST | `/api/login` | `{password}`, sets an HttpOnly cookie |
| POST/PUT/DELETE | `/api/challenges[/:id]` | teacher login required |
| POST | `/api/attempts` | `{challengeId}`, starts the timer |
| POST | `/api/attempts/:id/stop` | server computes duration |
| POST | `/api/attempts/:id/rating` | `{enjoyment: 1-5, comment}` after stop, once only |

## Prototype limits

- One shared teacher password, no per-teacher accounts.
- Admin sessions are in memory, so a restart logs everyone out.
- Writes go to a JSON file, which is fine for one server but not for multiple instances.
- Served over plain HTTP here; put it behind TLS in production.
- The QR library loads from jsdelivr, so the admin page needs internet access.
