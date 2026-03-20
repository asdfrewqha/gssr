# Step 5: Frontend — Game UI

## Goal

Run the React + Vite game UI locally and deploy to Cloudflare Pages.

## Prerequisites

- Node.js 20+ and npm
- Steps 2–4 completed (game service + workers running)

## Steps

### 1. Install dependencies

```bash
cd frontend
npm install
```

### 2. Set environment variables

```bash
cp .env.example .env.local
# Edit .env.local:
```

```bash
VITE_API_URL=http://localhost:3000       # game service
VITE_WS_URL=ws://localhost:3000          # WebSocket
VITE_MINIO_URL=http://localhost:9000/gssr  # tile CDN base URL
VITE_LIVEKIT_URL=ws://localhost:7880     # voice chat
```

### 3. Run dev server

```bash
npm run dev
# → http://localhost:5173
```

### 4. Build for production

```bash
npm run build
# Output: dist/
```

### 5. Deploy to Cloudflare Pages

```bash
npx wrangler pages deploy dist --project-name=gssr-frontend
# Or via CI (see docs/steps/10-cicd.md)
```

## Key Components

### PanoramaViewer (Marzipano)

Marzipano is loaded as a script tag from `public/marzipano/marzipano.js`.
Tile URL pattern:

```text
{VITE_MINIO_URL}/maps/{map_id}/panoramas/{pano_id}/{zoom}/{col}_{row}.webp
```

The `useMarzipano` hook constructs a `RectilinearView` and attaches a `ImageUrlSource` with the tile pattern above.

### GuessMap (Leaflet)

Uses `L.CRS.Simple` (flat coordinate system). Floor image loaded as `L.imageOverlay` at bounds `[[0,0],[y_max,x_max]]`.
On click: stores `{x, y, floor_id}` in zustand `gameStore.myGuess`.

### NSFW Avatar Check

On profile avatar upload, before sending to server:

```typescript
import * as nsfwjs from 'nsfwjs'
const model = await nsfwjs.load()
const predictions = await model.classify(imgElement)
const isNSFW = predictions.some(p =>
  ['Porn', 'Hentai', 'Sexy'].includes(p.className) && p.probability > 0.7
)
```

If `isNSFW === true`, show error to user and abort upload.

### WebSocket Reconnect

`useWebSocket` hook uses exponential backoff: 1s, 2s, 4s, 8s, max 30s.
On reconnect, fetches current room state via REST (`GET /api/rooms/:id`) to resync.

## Verification

1. Open `http://localhost:5173` → login page appears
2. Register + login → redirected to Home (room list)
3. Create room → Lobby page with shareable room link
4. Open two browser tabs with two users → both appear in player list
5. Start game → PanoramaViewer loads tiles, GuessMap shows floor image
6. Submit guess → score appears on Results page

## Troubleshooting

- **Tiles not loading**: check `VITE_MINIO_URL`, ensure MinIO bucket is publicly readable or tiles are pre-signed
- **WebSocket connection refused**: check `VITE_WS_URL`, Nginx WS proxy config (`Upgrade`, `Connection` headers)
- **Marzipano blank screen**: check browser console for CORS errors on tile requests from MinIO
- **"nsfwjs model not found"**: model is fetched from CDN on first load — needs internet access
