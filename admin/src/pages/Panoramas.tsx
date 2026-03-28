import { useEffect, useState } from "react";
import api from "../api/adminClient";

interface Pano {
  id: string;
  floor_id: string;
  floor_number: number;
  map_id: string;
  map_name: string;
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

type Tab = "pending" | "all";

export default function Panoramas() {
  const [tab, setTab] = useState<Tab>("pending");
  const [panos, setPanos] = useState<Pano[]>([]);
  const [loading, setLoading] = useState(false);
  const [modStatus, setModStatus] = useState("");
  const [tileStatus, setTileStatus] = useState("");

  const load = () => {
    setLoading(true);
    const req =
      tab === "pending"
        ? api.get<Pano[]>("/admin/panoramas/pending")
        : api.get<Pano[]>("/admin/panoramas", {
            params: {
              moderation_status: modStatus || undefined,
              tile_status: tileStatus || undefined,
              per_page: 200,
            },
          });
    req.then((r) => setPanos(r.data)).finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [tab, modStatus, tileStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  const approve = async (id: string) => {
    await api.post(`/admin/panoramas/${id}/approve`);
    load();
  };
  const reject = async (id: string) => {
    await api.post(`/admin/panoramas/${id}/reject`);
    load();
  };
  const retile = async (id: string) => {
    await api.post(`/admin/panoramas/${id}/retile`);
    load();
  };
  const del = async (id: string) => {
    if (!confirm("Delete this panorama permanently?")) return;
    await api.delete(`/admin/panoramas/${id}`);
    load();
  };

  const previewUrl = (panoId: string) => {
    const base = import.meta.env.VITE_S3_URL || "";
    return `${base}/gssr-panoramas/raw/${panoId}.jpg`;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Panoramas</h1>

      {/* Tabs */}
      <div className="flex gap-2">
        {(["pending", "all"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === t
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {t === "pending" ? "Pending Review" : "All Panoramas"}
          </button>
        ))}
      </div>

      {/* Filters for "all" tab */}
      {tab === "all" && (
        <div className="flex gap-3 text-sm">
          <div>
            <label className="text-xs text-gray-400 block">Moderation</label>
            <select
              className="mt-1 bg-gray-800 text-white rounded px-3 py-1.5 outline-none focus:ring-2 focus:ring-indigo-500"
              value={modStatus}
              onChange={(e) => setModStatus(e.target.value)}
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="clean">Clean</option>
              <option value="flagged">Flagged</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block">Tile status</label>
            <select
              className="mt-1 bg-gray-800 text-white rounded px-3 py-1.5 outline-none focus:ring-2 focus:ring-indigo-500"
              value={tileStatus}
              onChange={(e) => setTileStatus(e.target.value)}
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="tiled">Tiled</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>
      )}

      {loading && <p className="text-gray-400 text-sm">Loading…</p>}

      {!loading && panos.length === 0 && (
        <p className="text-gray-500 text-sm">
          {tab === "pending"
            ? "No panoramas pending review."
            : "No panoramas found."}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {panos.map((p) => (
          <div
            key={p.id}
            className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden"
          >
            {/* Preview thumbnail */}
            <div className="h-32 bg-gray-800 relative overflow-hidden">
              <img
                src={previewUrl(p.id)}
                alt="panorama preview"
                className="w-full h-full object-cover object-center"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              <div className="absolute top-2 right-2 flex gap-1">
                <span
                  className={`text-xs px-2 py-0.5 rounded bg-gray-900/80 ${STATUS_COLOR[p.tile_status] ?? "text-gray-400"}`}
                >
                  {p.tile_status}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded bg-gray-900/80 ${STATUS_COLOR[p.moderation_status] ?? "text-gray-400"}`}
                >
                  {p.moderation_status}
                </span>
              </div>
            </div>

            {/* Info */}
            <div className="p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-mono text-gray-400">
                    {p.id.slice(0, 16)}…
                  </p>
                  <p className="text-sm text-white font-medium">{p.map_name}</p>
                  <p className="text-xs text-gray-400">
                    Floor {p.floor_number} · ({p.x.toFixed(1)}, {p.y.toFixed(1)}
                    )
                    {p.nsfw_score != null && (
                      <span
                        className={p.nsfw_score > 0.5 ? " text-orange-400" : ""}
                      >
                        {" "}
                        · NSFW {(p.nsfw_score * 100).toFixed(0)}%
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 flex-wrap">
                {p.moderation_status !== "clean" && (
                  <button
                    onClick={() => approve(p.id)}
                    className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1 rounded transition-colors"
                  >
                    Approve
                  </button>
                )}
                {p.moderation_status !== "rejected" && (
                  <button
                    onClick={() => reject(p.id)}
                    className="text-xs bg-red-700 hover:bg-red-600 text-white px-3 py-1 rounded transition-colors"
                  >
                    Reject
                  </button>
                )}
                {p.tile_status === "failed" && (
                  <button
                    onClick={() => retile(p.id)}
                    className="text-xs bg-yellow-700 hover:bg-yellow-600 text-white px-3 py-1 rounded transition-colors"
                  >
                    Retile
                  </button>
                )}
                <button
                  onClick={() => del(p.id)}
                  className="text-xs text-red-500 hover:text-red-400 ml-auto"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
