import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api/adminClient";

interface Floor {
  id: string;
  floor_number: number;
  label: string;
  image_url: string | null;
  pano_count: number;
}

interface MapDetail {
  id: string;
  name: string;
  description: string;
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
  coord_type: string;
  floors: Floor[];
}

interface Pano {
  id: string;
  floor_id: string;
  floor_number: number;
  x: number;
  y: number;
  tile_status: string;
  moderation_status: string;
  nsfw_score: number | null;
  created_at: string;
}

const STATUS_COLOR: Record<string, string> = {
  tiled: "text-green-400",
  pending: "text-yellow-400",
  failed: "text-red-400",
  clean: "text-green-400",
  flagged: "text-orange-400",
  rejected: "text-red-400",
};

export default function MapDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [map, setMap] = useState<MapDetail | null>(null);
  const [panos, setPanos] = useState<Pano[]>([]);
  const [error, setError] = useState("");

  // Floor form
  const [floorForm, setFloorForm] = useState({ floor_number: "1", label: "" });
  const [floorImage, setFloorImage] = useState<File | null>(null);
  const [addingFloor, setAddingFloor] = useState(false);

  // Edit map form
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    description: "",
    x_min: "0",
    x_max: "1",
    y_min: "0",
    y_max: "1",
    coord_type: "normalized",
  });
  const [saving, setSaving] = useState(false);

  // Pano upload
  const [selectedFloor, setSelectedFloor] = useState("");
  const [panoForm, setPanoForm] = useState({
    x: "0.5",
    y: "0.5",
    north_offset: "0",
  });
  const [panoFile, setPanoFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStep, setUploadStep] = useState<
    "idle" | "uploading" | "tiling" | "done" | "failed"
  >("idle");
  const [tilingPanoId, setTilingPanoId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const floorImgRef = useRef<HTMLImageElement>(null);

  const loadMap = () =>
    api.get<MapDetail>(`/admin/maps/${id}`).then((r) => {
      setMap(r.data);
      setEditForm({
        name: r.data.name,
        description: r.data.description,
        x_min: String(r.data.x_min),
        x_max: String(r.data.x_max),
        y_min: String(r.data.y_min),
        y_max: String(r.data.y_max),
        coord_type: r.data.coord_type,
      });
      if (r.data.floors.length > 0 && !selectedFloor) {
        setSelectedFloor(r.data.floors[0].id);
      }
    });

  const loadPanos = () =>
    api
      .get<
        Pano[]
      >("/admin/panoramas", { params: { floor_id: undefined, per_page: 200 } })
      .then((r) => {
        // Filter client-side to current map floors
        if (map) {
          const floorIds = new Set(map.floors.map((f) => f.id));
          setPanos(r.data.filter((p) => floorIds.has(p.floor_id)));
        } else {
          setPanos(r.data);
        }
      });

  useEffect(() => {
    loadMap();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (map) loadPanos();
  }, [map?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set default selected floor when map loads
  useEffect(() => {
    if (map?.floors.length && !selectedFloor) {
      setSelectedFloor(map.floors[0].id);
    }
  }, [map?.floors]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await api.put(`/admin/maps/${id}`, editForm);
    setSaving(false);
    setEditMode(false);
    loadMap();
  };

  const addFloor = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingFloor(true);
    const fd = new FormData();
    fd.append("floor_number", floorForm.floor_number);
    fd.append("label", floorForm.label || floorForm.floor_number);
    if (floorImage) fd.append("image", floorImage);
    await api.post(`/admin/maps/${id}/floors`, fd);
    setFloorForm({ floor_number: "1", label: "" });
    setFloorImage(null);
    setAddingFloor(false);
    loadMap();
  };

  const deleteFloor = async (floorId: string) => {
    if (!confirm("Delete this floor and all its panoramas?")) return;
    await api.delete(`/admin/maps/${id}/floors/${floorId}`);
    loadMap();
  };

  const uploadPano = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!panoFile || !selectedFloor) return;
    setUploading(true);
    setUploadStep("uploading");
    setError("");
    try {
      // Step 1: get presigned URL + create DB record
      const { data } = await api.get<{ pano_id: string; upload_url: string }>(
        "/admin/panoramas/upload-url",
        {
          params: {
            floor_id: selectedFloor,
            x: panoForm.x,
            y: panoForm.y,
            north_offset: panoForm.north_offset,
          },
        },
      );

      // Step 2: PUT file directly to MinIO (no auth headers needed — presigned)
      const putRes = await fetch(data.upload_url, {
        method: "PUT",
        body: panoFile,
        headers: { "Content-Type": "image/jpeg" },
      });
      if (!putRes.ok) throw new Error(`MinIO PUT failed: ${putRes.status}`);

      // Step 3: trigger tiling + NSFW tasks
      await api.post("/admin/panoramas/confirm-upload", {
        pano_id: data.pano_id,
      });

      setPanoFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setPanoForm({ x: "0.5", y: "0.5", north_offset: "0" });
      setTilingPanoId(data.pano_id);
      setUploadStep("tiling");
      loadPanos();

      // Subscribe to tiling status via WebSocket
      const base = import.meta.env.VITE_API_BASE || "";
      const wsBase = base
        ? base.replace(/^http/, "ws")
        : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
      const ws = new WebSocket(`${wsBase}/admin/ws/pano/${data.pano_id}`);
      ws.onmessage = (e) => {
        if (e.data === "tiled") {
          setUploadStep("done");
          ws.close();
          loadPanos();
        } else if (e.data === "failed") {
          setUploadStep("failed");
          ws.close();
          loadPanos();
        }
      };
      ws.onerror = () => ws.close();
    } catch (err) {
      setError(
        (err as { response?: { data?: { detail?: string } } }).response?.data
          ?.detail ??
          (err as Error).message ??
          "Upload failed",
      );
      setUploadStep("failed");
    } finally {
      setUploading(false);
    }
  };

  const onFloorImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const img = floorImgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width).toFixed(3);
    const y = ((e.clientY - rect.top) / rect.height).toFixed(3);
    setPanoForm((f) => ({ ...f, x, y }));
  };

  const deletePano = async (panoId: string) => {
    if (!confirm("Delete this panorama?")) return;
    await api.delete(`/admin/panoramas/${panoId}`);
    loadPanos();
  };

  if (!map) return <p className="text-gray-400">Loading…</p>;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/maps")}
          className="text-gray-400 hover:text-white text-sm"
        >
          ← Maps
        </button>
        <h1 className="text-2xl font-bold text-white">{map.name}</h1>
        <button
          onClick={() => setEditMode((v) => !v)}
          className="ml-auto text-xs text-gray-400 hover:text-white border border-gray-700 px-3 py-1 rounded"
        >
          {editMode ? "Cancel" : "Edit"}
        </button>
      </div>

      {/* Edit form */}
      {editMode && (
        <form
          onSubmit={saveEdit}
          className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3"
        >
          <div>
            <label className="text-xs text-gray-400">Name</label>
            <input
              className="mt-1 w-full bg-gray-800 text-white rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              value={editForm.name}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, name: e.target.value }))
              }
              required
            />
          </div>
          <div>
            <label className="text-xs text-gray-400">Description</label>
            <input
              className="mt-1 w-full bg-gray-800 text-white rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              value={editForm.description}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, description: e.target.value }))
              }
            />
          </div>
          <div>
            <label className="text-xs text-gray-400">Coordinate bounds</label>
            <div className="mt-1 grid grid-cols-4 gap-2">
              {(["x_min", "x_max", "y_min", "y_max"] as const).map((k) => (
                <div key={k}>
                  <label className="text-xs text-gray-500">{k}</label>
                  <input
                    type="number"
                    step="any"
                    className="mt-0.5 w-full bg-gray-800 text-white rounded px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    value={editForm[k]}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, [k]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400">Coord type</label>
            <input
              className="mt-1 w-full bg-gray-800 text-white rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              value={editForm.coord_type}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, coord_type: e.target.value }))
              }
              placeholder="normalized / pixels / meters"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-1.5 rounded disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </form>
      )}

      {/* Map info */}
      <div className="text-sm text-gray-400">
        Bounds: x {map.x_min}–{map.x_max} / y {map.y_min}–{map.y_max} ·{" "}
        {map.coord_type}
      </div>

      {/* Floors */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">Floors</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {map.floors.map((f) => (
            <div
              key={f.id}
              className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex justify-between items-start gap-3"
            >
              {f.image_url && (
                <img
                  src={`${import.meta.env.VITE_S3_URL}${f.image_url}`}
                  alt={`Floor ${f.floor_number}`}
                  className="w-16 h-16 object-cover rounded border border-gray-700 shrink-0"
                />
              )}
              <div className="flex-1">
                <p className="font-medium text-white">
                  Floor {f.floor_number}
                  {f.label && f.label !== String(f.floor_number)
                    ? ` — ${f.label}`
                    : ""}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {f.pano_count} panorama(s)
                </p>
              </div>
              <button
                onClick={() => deleteFloor(f.id)}
                className="text-red-500 hover:text-red-400 text-xs shrink-0"
              >
                Delete
              </button>
            </div>
          ))}
        </div>

        {/* Add floor */}
        <form
          onSubmit={addFloor}
          className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3"
        >
          <h3 className="text-sm font-medium text-white">Add Floor</h3>
          <div className="flex gap-3">
            <div>
              <label className="text-xs text-gray-400">Number</label>
              <input
                type="number"
                className="mt-1 w-20 bg-gray-800 text-white rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                value={floorForm.floor_number}
                onChange={(e) =>
                  setFloorForm((f) => ({ ...f, floor_number: e.target.value }))
                }
                required
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-400">Label (optional)</label>
              <input
                className="mt-1 w-full bg-gray-800 text-white rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g. Ground Floor"
                value={floorForm.label}
                onChange={(e) =>
                  setFloorForm((f) => ({ ...f, label: e.target.value }))
                }
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400">
              Floor plan image (optional)
            </label>
            <input
              type="file"
              accept="image/*"
              className="mt-1 text-sm text-gray-300"
              onChange={(e) => setFloorImage(e.target.files?.[0] ?? null)}
            />
          </div>
          <button
            type="submit"
            disabled={addingFloor}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-1.5 rounded disabled:opacity-50"
          >
            {addingFloor ? "Adding…" : "Add Floor"}
          </button>
        </form>
      </section>

      {/* Upload Panorama */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">Upload Panorama</h2>
        {map.floors.length === 0 ? (
          <p className="text-sm text-gray-500">Add a floor first.</p>
        ) : (
          <form
            onSubmit={uploadPano}
            className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3"
          >
            {error && <p className="text-red-400 text-sm">{error}</p>}
            {uploadStep === "tiling" && (
              <p className="text-yellow-400 text-sm">
                Tiling in progress… ({tilingPanoId?.slice(0, 8)})
              </p>
            )}
            {uploadStep === "done" && (
              <p className="text-green-400 text-sm">Tiling complete.</p>
            )}
            {uploadStep === "failed" && (
              <p className="text-red-400 text-sm">
                Tiling failed — check Celery logs.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400">Floor</label>
                <select
                  className="mt-1 w-full bg-gray-800 text-white rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  value={selectedFloor}
                  onChange={(e) => setSelectedFloor(e.target.value)}
                  required
                >
                  {map.floors.map((f) => (
                    <option key={f.id} value={f.id}>
                      Floor {f.floor_number} {f.label ? `— ${f.label}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400">
                  North offset (deg)
                </label>
                <input
                  type="number"
                  step="any"
                  className="mt-1 w-full bg-gray-800 text-white rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  value={panoForm.north_offset}
                  onChange={(e) =>
                    setPanoForm((f) => ({ ...f, north_offset: e.target.value }))
                  }
                />
              </div>
            </div>

            {/* Click-to-place on floor plan */}
            {(() => {
              const floor = map.floors.find((f) => f.id === selectedFloor);
              return floor?.image_url ? (
                <div>
                  <label className="text-xs text-gray-400">
                    Click on floor plan to place panorama
                    <span className="ml-2 text-gray-500">
                      (x={Number(panoForm.x).toFixed(3)}, y=
                      {Number(panoForm.y).toFixed(3)})
                    </span>
                  </label>
                  <div className="mt-1 relative inline-block cursor-crosshair">
                    <img
                      ref={floorImgRef}
                      src={`${import.meta.env.VITE_S3_URL}${floor.image_url}`}
                      alt="Floor plan"
                      className="max-w-full max-h-64 rounded border border-gray-700"
                      onClick={onFloorImageClick}
                    />
                    <div
                      className="absolute w-3 h-3 bg-indigo-500 rounded-full border-2 border-white -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                      style={{
                        left: `${Number(panoForm.x) * 100}%`,
                        top: `${Number(panoForm.y) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400">X (0–1)</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      max="1"
                      className="mt-1 w-full bg-gray-800 text-white rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      value={panoForm.x}
                      onChange={(e) =>
                        setPanoForm((f) => ({ ...f, x: e.target.value }))
                      }
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400">Y (0–1)</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      max="1"
                      className="mt-1 w-full bg-gray-800 text-white rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      value={panoForm.y}
                      onChange={(e) =>
                        setPanoForm((f) => ({ ...f, y: e.target.value }))
                      }
                      required
                    />
                  </div>
                </div>
              );
            })()}

            <div>
              <label className="text-xs text-gray-400">
                Equirectangular JPEG
              </label>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg"
                className="mt-1 text-sm text-gray-300"
                onChange={(e) => setPanoFile(e.target.files?.[0] ?? null)}
                required
              />
            </div>
            <button
              type="submit"
              disabled={uploading || !panoFile}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-1.5 rounded disabled:opacity-50 transition-colors"
            >
              {uploading
                ? uploadStep === "uploading"
                  ? "Uploading to MinIO…"
                  : "Starting tiling…"
                : "Upload"}
            </button>
          </form>
        )}
      </section>

      {/* Panoramas list */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">
          Panoramas ({panos.length})
        </h2>
        {panos.length === 0 ? (
          <p className="text-sm text-gray-500">No panoramas yet.</p>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">ID</th>
                  <th className="px-4 py-3 font-medium">Floor</th>
                  <th className="px-4 py-3 font-medium">Pos</th>
                  <th className="px-4 py-3 font-medium">Tile</th>
                  <th className="px-4 py-3 font-medium">Mod</th>
                  <th className="px-4 py-3 font-medium">NSFW</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {panos.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-gray-800/50 hover:bg-gray-800/30"
                  >
                    <td className="px-4 py-2 font-mono text-xs text-gray-400">
                      {p.id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-2 text-gray-300">
                      {p.floor_number}
                    </td>
                    <td className="px-4 py-2 text-gray-400 text-xs">
                      {p.x.toFixed(1)}, {p.y.toFixed(1)}
                    </td>
                    <td
                      className={`px-4 py-2 text-xs ${STATUS_COLOR[p.tile_status] ?? "text-gray-400"}`}
                    >
                      {p.tile_status}
                    </td>
                    <td
                      className={`px-4 py-2 text-xs ${STATUS_COLOR[p.moderation_status] ?? "text-gray-400"}`}
                    >
                      {p.moderation_status}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-400">
                      {p.nsfw_score != null
                        ? (p.nsfw_score * 100).toFixed(0) + "%"
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => deletePano(p.id)}
                        className="text-red-500 hover:text-red-400 text-xs"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
