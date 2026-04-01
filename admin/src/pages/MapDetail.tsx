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

const S3 = import.meta.env.VITE_S3_URL ?? "";

// ── tiny helper ──────────────────────────────────────────────────────────────
function apiError(err: unknown, fallback = "Error"): string {
  const e = err as {
    response?: { data?: { detail?: string } };
    message?: string;
  };
  return e?.response?.data?.detail ?? e?.message ?? fallback;
}

// ── Floor plan with pano dots + drag-and-drop ─────────────────────────────────
function FloorPlan({
  floor,
  panos,
  pendingX,
  pendingY,
  onClick,
  onPanoDragEnd,
}: {
  floor: Floor;
  panos: Pano[];
  pendingX?: number;
  pendingY?: number;
  onClick?: (x: number, y: number) => void;
  onPanoDragEnd?: (id: string, x: number, y: number) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [dragging, setDragging] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);

  if (!floor.image_url) return null;

  const toRelative = (clientX: number, clientY: number) => {
    if (!imgRef.current) return { x: 0, y: 0 };
    const rect = imgRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };

  const handleClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!onClick || dragging) return;
    const { x, y } = toRelative(e.clientX, e.clientY);
    onClick(x, y);
  };

  return (
    <div
      className="relative inline-block select-none"
      onMouseMove={(e) => {
        if (!dragging) return;
        const { x, y } = toRelative(e.clientX, e.clientY);
        setDragging({ ...dragging, x, y });
      }}
      onMouseUp={() => {
        if (dragging) {
          onPanoDragEnd?.(dragging.id, dragging.x, dragging.y);
          setDragging(null);
        }
      }}
      onMouseLeave={() => {
        if (dragging) {
          onPanoDragEnd?.(dragging.id, dragging.x, dragging.y);
          setDragging(null);
        }
      }}
    >
      <img
        ref={imgRef}
        src={`${S3}${floor.image_url}`}
        alt={`Floor ${floor.floor_number}`}
        className={`max-w-full rounded border border-gray-700 ${onClick ? "cursor-crosshair max-h-64" : "max-h-32 object-cover"}`}
        onClick={handleClick}
        draggable={false}
      />
      {/* Existing pano dots */}
      {panos.map((p) => {
        const isDragging = dragging?.id === p.id;
        const cx = isDragging ? dragging.x : p.x;
        const cy = isDragging ? dragging.y : p.y;
        return (
          <div
            key={p.id}
            title={`${p.id.slice(0, 8)} (${p.tile_status}) — drag to move`}
            className={`absolute w-2.5 h-2.5 rounded-full border border-white -translate-x-1/2 -translate-y-1/2 ${onPanoDragEnd ? "cursor-move" : "pointer-events-none"} ${isDragging ? "opacity-80 scale-125" : ""}`}
            style={{
              left: `${cx * 100}%`,
              top: `${cy * 100}%`,
              background:
                p.tile_status === "tiled"
                  ? "#6366f1"
                  : p.tile_status === "failed"
                    ? "#ef4444"
                    : "#f59e0b",
              transition: isDragging ? "none" : undefined,
            }}
            onMouseDown={(e) => {
              if (!onPanoDragEnd) return;
              e.stopPropagation();
              e.preventDefault();
              setDragging({ id: p.id, x: p.x, y: p.y });
            }}
          />
        );
      })}
      {/* Pending new pano dot */}
      {pendingX !== undefined && pendingY !== undefined && (
        <div
          className="absolute w-3 h-3 bg-green-400 rounded-full border-2 border-white -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{ left: `${pendingX * 100}%`, top: `${pendingY * 100}%` }}
        />
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MapDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [map, setMap] = useState<MapDetail | null>(null);
  const [panos, setPanos] = useState<Pano[]>([]);
  const [pageError, setPageError] = useState("");

  // Edit map
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
  const [saveError, setSaveError] = useState("");

  // Add floor
  const [addingFloor, setAddingFloor] = useState(false);
  const [floorLabel, setFloorLabel] = useState("");
  const [floorImage, setFloorImage] = useState<File | null>(null);
  const [floorError, setFloorError] = useState("");
  const floorImgInputRef = useRef<HTMLInputElement>(null);

  // Update floor image
  const [updatingFloorId, setUpdatingFloorId] = useState<string | null>(null);

  // Pano upload — batch-aware
  const [selectedFloor, setSelectedFloor] = useState("");
  const [panoPos, setPanoPos] = useState({ x: 0.5, y: 0.5 });
  const [northOffset, setNorthOffset] = useState("0");
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchIdx, setBatchIdx] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadStep, setUploadStep] = useState<
    "idle" | "uploading" | "tiling" | "done" | "failed"
  >("idle");
  const [uploadError, setUploadError] = useState("");
  const [tilingPanoId, setTilingPanoId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Partial panorama / source format
  const [haov, setHaov] = useState(360);
  const [vaov, setVaov] = useState(180);
  const [voffset, setVoffset] = useState(0);
  const [dualFisheye, setDualFisheye] = useState(false);

  // ── data loaders ──────────────────────────────────────────────────────────

  const loadMap = () =>
    api
      .get<MapDetail>(`/admin/maps/${id}`)
      .then((r) => {
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
      })
      .catch(() => setPageError("Failed to load map"));

  const loadPanos = (currentMap: MapDetail) =>
    api
      .get<Pano[]>("/admin/panoramas", { params: { per_page: 500 } })
      .then((r) => {
        const floorIds = new Set(currentMap.floors.map((f) => f.id));
        setPanos(r.data.filter((p) => floorIds.has(p.floor_id)));
      });

  useEffect(() => {
    loadMap();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (map) loadPanos(map);
  }, [map?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (map?.floors.length && !selectedFloor) {
      setSelectedFloor(map.floors[0].id);
    }
  }, [map?.floors]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── handlers ──────────────────────────────────────────────────────────────

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError("");
    try {
      await api.put(`/admin/maps/${id}`, editForm);
      setEditMode(false);
      loadMap();
    } catch (err) {
      setSaveError(apiError(err, "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  const addFloor = async () => {
    if (!map) return;
    const nextNum = map.floors.length
      ? Math.max(...map.floors.map((f) => f.floor_number)) + 1
      : 1;
    setFloorError("");
    setAddingFloor(true);
    const fd = new FormData();
    fd.append("floor_number", String(nextNum));
    fd.append("label", floorLabel || String(nextNum));
    if (floorImage) fd.append("image", floorImage);
    try {
      await api.post(`/admin/maps/${id}/floors`, fd);
      setFloorLabel("");
      setFloorImage(null);
      if (floorImgInputRef.current) floorImgInputRef.current.value = "";
      loadMap();
    } catch (err) {
      setFloorError(apiError(err, "Failed to add floor"));
    } finally {
      setAddingFloor(false);
    }
  };

  const updateFloorImage = async (floorId: string, file: File) => {
    setUpdatingFloorId(floorId);
    const fd = new FormData();
    fd.append("image", file);
    try {
      await api.patch(`/admin/maps/${id}/floors/${floorId}`, fd);
      loadMap();
    } catch (err) {
      alert(apiError(err, "Image update failed"));
    } finally {
      setUpdatingFloorId(null);
    }
  };

  const deleteFloor = async (floorId: string) => {
    if (!confirm("Delete this floor and all its panoramas?")) return;
    try {
      await api.delete(`/admin/maps/${id}/floors/${floorId}`);
      loadMap();
    } catch (err) {
      alert(apiError(err, "Delete failed"));
    }
  };

  const movePano = async (panoId: string, x: number, y: number) => {
    try {
      await api.patch(`/admin/panoramas/${panoId}`, { x, y });
      if (map) loadPanos(map);
    } catch (err) {
      alert(apiError(err, "Move failed"));
    }
  };

  /** Upload a single panorama file to a given position + floor. */
  const uploadSingle = async (
    file: File,
    pos: { x: number; y: number },
    floorId: string,
  ) => {
    setUploading(true);
    setUploadStep("uploading");
    setUploadError("");
    try {
      const { data } = await api.get<{ pano_id: string; upload_url: string }>(
        "/admin/panoramas/upload-url",
        {
          params: {
            floor_id: floorId,
            x: pos.x.toFixed(4),
            y: pos.y.toFixed(4),
            north_offset: northOffset,
            haov: dualFisheye ? 360 : haov,
            vaov: dualFisheye ? 180 : vaov,
            voffset: dualFisheye ? 0 : voffset,
            source_format: dualFisheye ? "dual_fisheye" : "equirectangular",
          },
        },
      );

      const putRes = await fetch(data.upload_url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": "image/jpeg" },
      });
      if (!putRes.ok) throw new Error(`MinIO PUT failed: ${putRes.status}`);

      await api.post("/admin/panoramas/confirm-upload", {
        pano_id: data.pano_id,
      });

      setTilingPanoId(data.pano_id);
      setUploadStep("tiling");
      if (map) loadPanos(map);

      const base = import.meta.env.VITE_API_BASE || "";
      const wsBase = base
        ? base.replace(/^http/, "ws")
        : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
      const ws = new WebSocket(`${wsBase}/admin/ws/pano/${data.pano_id}`);
      ws.onmessage = (ev) => {
        if (ev.data === "tiled") {
          setUploadStep("done");
          ws.close();
          if (map) loadPanos(map);
        } else if (ev.data === "failed") {
          setUploadStep("failed");
          ws.close();
          if (map) loadPanos(map);
        }
      };
      ws.onerror = () => ws.close();
    } catch (err) {
      setUploadError(apiError(err, "Upload failed"));
      setUploadStep("failed");
    } finally {
      setUploading(false);
    }
  };

  /** Form submit handler — used for single-file mode. */
  const uploadPano = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchFiles.length || !selectedFloor) return;
    const file = batchFiles[0];
    await uploadSingle(file, panoPos, selectedFloor);
    setBatchFiles([]);
    setBatchIdx(0);
    if (fileRef.current) fileRef.current.value = "";
  };

  /** Called when user clicks on the floor plan in the upload section. */
  const handleUploadMapClick = async (x: number, y: number) => {
    if (!selectedFloor || uploading) return;
    setPanoPos({ x, y });

    // In batch mode, auto-upload the current file and advance to the next
    if (batchFiles.length > 1 && batchIdx < batchFiles.length) {
      const file = batchFiles[batchIdx];
      await uploadSingle(file, { x, y }, selectedFloor);
      const next = batchIdx + 1;
      setBatchIdx(next);
      if (next >= batchFiles.length) {
        setBatchFiles([]);
        setBatchIdx(0);
        if (fileRef.current) fileRef.current.value = "";
      }
    }
  };

  const deletePano = async (panoId: string) => {
    if (!confirm("Delete this panorama?")) return;
    try {
      await api.delete(`/admin/panoramas/${panoId}`);
      if (map) loadPanos(map);
    } catch (err) {
      alert(apiError(err, "Delete failed"));
    }
  };

  // ── render ────────────────────────────────────────────────────────────────

  if (!map) {
    return <p className="text-gray-400">{pageError || "Loading…"}</p>;
  }

  const nextFloorNum = map.floors.length
    ? Math.max(...map.floors.map((f) => f.floor_number)) + 1
    : 1;

  const activeFloor = map.floors.find((f) => f.id === selectedFloor);
  const panosForFloor = (fid: string) =>
    panos.filter((p) => p.floor_id === fid);

  const isBatch = batchFiles.length > 1;
  const currentFile = batchFiles[batchIdx] ?? batchFiles[0];

  return (
    <div className="space-y-6 max-w-4xl">
      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/maps")}
          className="text-gray-400 hover:text-white text-sm"
        >
          ← Maps
        </button>
        <h1 className="text-2xl font-bold text-white">{map.name}</h1>
        <button
          onClick={() => {
            setEditMode((v) => !v);
            setSaveError("");
          }}
          className="ml-auto text-xs text-gray-400 hover:text-white border border-gray-700 px-3 py-1 rounded"
        >
          {editMode ? "Cancel" : "Edit"}
        </button>
      </div>

      {/* ── Edit form ── */}
      {editMode && (
        <form
          onSubmit={saveEdit}
          className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3"
        >
          {saveError && <p className="text-red-400 text-sm">{saveError}</p>}
          <div className="grid grid-cols-2 gap-3">
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
              className="mt-1 w-48 bg-gray-800 text-white rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
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

      {/* ── Map info ── */}
      {!editMode && (
        <p className="text-xs text-gray-500">
          Bounds: x {map.x_min}–{map.x_max} · y {map.y_min}–{map.y_max} ·{" "}
          {map.coord_type}
        </p>
      )}

      {/* ── Floors ── */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">
          Floors ({map.floors.length})
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {map.floors.map((f) => {
            const fp = panosForFloor(f.id);
            return (
              <div
                key={f.id}
                className="bg-gray-900 border border-gray-800 rounded-lg p-3 space-y-2"
              >
                {/* floor header */}
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white text-sm">
                    Floor {f.floor_number}
                    {f.label && f.label !== String(f.floor_number)
                      ? ` — ${f.label}`
                      : ""}
                  </span>
                  <span className="text-xs text-gray-500 ml-auto">
                    {fp.length} pano{fp.length !== 1 ? "s" : ""}
                  </span>
                  <button
                    onClick={() => deleteFloor(f.id)}
                    className="text-red-500 hover:text-red-400 text-xs"
                  >
                    Delete
                  </button>
                </div>

                {/* floor plan with draggable pano dots */}
                {f.image_url ? (
                  <FloorPlan floor={f} panos={fp} onPanoDragEnd={movePano} />
                ) : (
                  <p className="text-xs text-gray-600 italic">
                    No floor plan image
                  </p>
                )}
                {fp.length > 0 && (
                  <p className="text-xs text-gray-600">
                    Drag dots to reposition panoramas
                  </p>
                )}

                {/* replace image */}
                <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-500 hover:text-gray-300 transition-colors">
                  {updatingFloorId === f.id ? (
                    <span>Uploading…</span>
                  ) : (
                    <>
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                        />
                      </svg>
                      {f.image_url ? "Replace image" : "Upload image"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) updateFloorImage(f.id, file);
                          e.target.value = "";
                        }}
                      />
                    </>
                  )}
                </label>
              </div>
            );
          })}
        </div>

        {/* ── Add floor ── */}
        {floorError && <p className="text-red-400 text-sm">{floorError}</p>}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-32">
            <label className="text-xs text-gray-400">Label (optional)</label>
            <input
              className="mt-1 w-full bg-gray-800 text-white rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder={`e.g. Floor ${nextFloorNum}`}
              value={floorLabel}
              onChange={(e) => setFloorLabel(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-400">Floor plan image</label>
            <input
              ref={floorImgInputRef}
              type="file"
              accept="image/*"
              className="mt-1 block text-sm text-gray-300"
              onChange={(e) => setFloorImage(e.target.files?.[0] ?? null)}
            />
          </div>
          <button
            onClick={addFloor}
            disabled={addingFloor}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-1.5 rounded disabled:opacity-50 shrink-0"
          >
            {addingFloor ? "Adding…" : `+ Floor ${nextFloorNum}`}
          </button>
        </div>
      </section>

      {/* ── Upload Panorama ── */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-white">Upload Panorama</h2>
        {map.floors.length === 0 ? (
          <p className="text-sm text-gray-500">Add a floor first.</p>
        ) : (
          <form
            onSubmit={uploadPano}
            className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3"
          >
            {/* status messages */}
            {uploadError && (
              <p className="text-red-400 text-sm">{uploadError}</p>
            )}
            {uploadStep === "tiling" && (
              <p className="text-yellow-400 text-sm">
                Tiling…{" "}
                <span className="font-mono text-xs">
                  {tilingPanoId?.slice(0, 8)}
                </span>
              </p>
            )}
            {uploadStep === "done" && (
              <p className="text-green-400 text-sm">✓ Tiled successfully.</p>
            )}
            {uploadStep === "failed" && !uploadError && (
              <p className="text-red-400 text-sm">
                Tiling failed — check Celery logs.
              </p>
            )}

            {/* Batch progress indicator */}
            {isBatch && batchIdx < batchFiles.length && (
              <p className="text-indigo-400 text-sm">
                Placing {batchIdx + 1}/{batchFiles.length}:{" "}
                <span className="font-mono text-xs">{currentFile?.name}</span> —
                click on the floor plan below
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
                      Floor {f.floor_number}
                      {f.label && f.label !== String(f.floor_number)
                        ? ` — ${f.label}`
                        : ""}
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
                  value={northOffset}
                  onChange={(e) => setNorthOffset(e.target.value)}
                />
              </div>
            </div>

            {/* Click-to-place on floor plan */}
            <div>
              <label className="text-xs text-gray-400">
                Position on floor plan
                <span className="ml-2 text-gray-500 font-mono">
                  x={panoPos.x.toFixed(3)} y={panoPos.y.toFixed(3)}
                </span>
              </label>
              {activeFloor?.image_url ? (
                <div className="mt-1">
                  <FloorPlan
                    floor={activeFloor}
                    panos={panosForFloor(activeFloor.id)}
                    pendingX={!isBatch ? panoPos.x : undefined}
                    pendingY={!isBatch ? panoPos.y : undefined}
                    onClick={handleUploadMapClick}
                  />
                  <p className="text-xs text-gray-600 mt-1">
                    {isBatch
                      ? `Click to place file ${batchIdx + 1}/${batchFiles.length} — uploads automatically`
                      : "Click floor plan to set position · indigo = existing · green = new"}
                  </p>
                </div>
              ) : (
                <div className="mt-1 grid grid-cols-2 gap-3">
                  {(["x", "y"] as const).map((k) => (
                    <div key={k}>
                      <label className="text-xs text-gray-500">
                        {k.toUpperCase()} (0–1)
                      </label>
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        max="1"
                        className="mt-0.5 w-full bg-gray-800 text-white rounded px-3 py-1 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                        value={panoPos[k]}
                        onChange={(e) =>
                          setPanoPos((p) => ({
                            ...p,
                            [k]: Number(e.target.value),
                          }))
                        }
                        required
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="text-xs text-gray-400">
                Equirectangular JPEG
                {batchFiles.length > 1 && (
                  <span className="ml-2 text-indigo-400">
                    {batchFiles.length} files selected
                  </span>
                )}
              </label>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg"
                multiple
                className="mt-1 block text-sm text-gray-300"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  setBatchFiles(files);
                  setBatchIdx(0);
                }}
                required
              />
            </div>

            {/* Advanced: partial panorama + dual fisheye */}
            <details className="text-sm">
              <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">
                Advanced options
              </summary>
              <div className="mt-2 space-y-2">
                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dualFisheye}
                    onChange={(e) => setDualFisheye(e.target.checked)}
                    className="accent-indigo-500"
                  />
                  Dual fisheye (Samsung Gear 360 / SM-C200) — auto-converts to
                  equirectangular
                </label>
                {!dualFisheye && (
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        {
                          label: "H-FOV°",
                          value: haov,
                          set: setHaov,
                          min: 1,
                          max: 360,
                        },
                        {
                          label: "V-FOV°",
                          value: vaov,
                          set: setVaov,
                          min: 1,
                          max: 180,
                        },
                        {
                          label: "V-Offset°",
                          value: voffset,
                          set: setVoffset,
                          min: -90,
                          max: 90,
                        },
                      ] as const
                    ).map(({ label, value, set, min, max }) => (
                      <div key={label}>
                        <label className="text-xs text-gray-500">{label}</label>
                        <input
                          type="number"
                          step="1"
                          min={min}
                          max={max}
                          value={value}
                          onChange={(e) => set(Number(e.target.value))}
                          className="mt-0.5 w-full bg-gray-800 text-white rounded px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>

            {/* Submit (single-file mode only; batch auto-submits on click) */}
            {!isBatch && (
              <button
                type="submit"
                disabled={uploading || !batchFiles.length}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-1.5 rounded disabled:opacity-50 transition-colors"
              >
                {uploading
                  ? uploadStep === "uploading"
                    ? "Uploading to MinIO…"
                    : "Queuing tiling…"
                  : "Upload"}
              </button>
            )}
          </form>
        )}
      </section>

      {/* ── Panoramas table ── */}
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
                <tr className="border-b border-gray-800 text-gray-400 text-left text-xs">
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">Floor</th>
                  <th className="px-3 py-2 font-medium">Pos</th>
                  <th className="px-3 py-2 font-medium">Tile</th>
                  <th className="px-3 py-2 font-medium">Mod</th>
                  <th className="px-3 py-2 font-medium">NSFW</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {panos.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-gray-800/50 hover:bg-gray-800/30"
                  >
                    <td className="px-3 py-2 font-mono text-xs text-gray-400">
                      {p.id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2 text-gray-300 text-xs">
                      {p.floor_number}
                    </td>
                    <td className="px-3 py-2 text-gray-400 text-xs font-mono">
                      {p.x.toFixed(2)},{p.y.toFixed(2)}
                    </td>
                    <td
                      className={`px-3 py-2 text-xs ${STATUS_COLOR[p.tile_status] ?? "text-gray-400"}`}
                    >
                      {p.tile_status}
                    </td>
                    <td
                      className={`px-3 py-2 text-xs ${STATUS_COLOR[p.moderation_status] ?? "text-gray-400"}`}
                    >
                      {p.moderation_status}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-400">
                      {p.nsfw_score != null
                        ? `${(p.nsfw_score * 100).toFixed(0)}%`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
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
