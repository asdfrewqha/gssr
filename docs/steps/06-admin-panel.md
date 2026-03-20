# Step 6: Admin Panel

## Goal

Run the React admin panel for uploading maps/panoramas, managing moderation queue, and user administration.

## Prerequisites

- Node.js 20+
- Step 4 (workers service) running — admin API at `:8000`
- Admin user account created (or use a hardcoded admin flag in users table)

## Steps

### 1. Install dependencies

```bash
cd admin
npm install
```

### 2. Set environment variables

```bash
cp .env.example .env.local
```

```bash
VITE_ADMIN_API_URL=http://localhost:8000   # workers FastAPI
VITE_MINIO_URL=http://localhost:9000/gssr  # panorama preview
```

### 3. Run dev server

```bash
npm run dev
# → http://localhost:5174
```

### 4. Deploy to Cloudflare Pages

```bash
npx wrangler pages deploy dist --project-name=gssr-admin
# This subdomain will be protected by Cloudflare Access (see docs/steps/08-cloudflare.md)
```

## Admin Workflows

### Adding a New Map

1. **Dashboard → Maps → New Map**
2. Enter map name and coordinate bounds (x_min, x_max, y_min, y_max in pixels)
3. **Add Floor** — upload floor plan image (JPEG/PNG/WebP)
4. Floor image uploads to MinIO at `/maps/{map_id}/floors/{floor_id}.webp`

### Uploading Panoramas

1. **Maps → select map → select floor → Upload Panorama**
2. Drag-drop equirectangular JPEG (8K recommended)
3. Set approximate X, Y coordinates on the floor plan using the FloorPlanEditor (Leaflet click)
4. Set `north_offset` (0–360°, direction of north in the panorama)
5. Submit → background tiling + NSFW check starts automatically
6. Progress bar polls `GET /admin/panoramas/{id}` every 3 seconds

### Moderation Queue

1. **Moderation** tab shows panoramas with `moderation_status = "flagged"`
2. Each card shows:
   - Panorama preview (first tile loaded via Marzipano thumbnail)
   - NSFW probability score
   - Floor and coordinates
3. **Approve** → `POST /admin/panoramas/{id}/approve` → status = "published"
4. **Reject** → `POST /admin/panoramas/{id}/reject` → tiles deleted from MinIO

### User Management

1. **Users** tab — paginated list with username, ELO, join date, status
2. Click user → **Ban** button → `PUT /admin/users/{id}/ban`
3. Banned users receive 403 on next API call (checked in game service JWT middleware)

## Verification

```bash
# Check admin API is accessible
curl http://localhost:8000/admin/stats
# → {"maps": 0, "panoramas": 0, "users": 0, "matches": 0}
```

1. Open `http://localhost:5174` → dashboard loads
2. Create a map → appears in maps list
3. Upload a 360° panorama → tiling progress visible
4. After tiling: panorama appears in floor's panorama list in the game frontend

## Troubleshooting

- **401 on admin API**: admin session cookie not set — login flow must set an `is_admin` claim in JWT
- **Upload progress stuck at 0%**: check Nginx `client_max_body_size` — set to at least `50m` for 8K panoramas
- **FloorPlanEditor not showing floor image**: check CORS headers on MinIO for the floor image URL
