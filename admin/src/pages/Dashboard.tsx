import { useEffect, useState } from "react";
import api from "../api/adminClient";

interface Stats {
  maps: number;
  floors: number;
  panoramas: { total: number; ready: number; pending_review: number };
  players: number;
  matches: { total: number; active: number };
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
      <p className="text-sm text-gray-400">{label}</p>
      <p className="text-3xl font-bold text-white mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<Stats>("/admin/stats")
      .then((r) => setStats(r.data))
      .catch(() => setError("Failed to load stats"));
  }, []);

  if (error) return <p className="text-red-400">{error}</p>;
  if (!stats) return <p className="text-gray-400">Loading…</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard
          label="Maps"
          value={stats.maps}
          sub={`${stats.floors} floors`}
        />
        <StatCard
          label="Panoramas"
          value={stats.panoramas.total}
          sub={`${stats.panoramas.ready} ready · ${stats.panoramas.pending_review} pending review`}
        />
        <StatCard label="Players" value={stats.players} />
        <StatCard
          label="Matches"
          value={stats.matches.total}
          sub={`${stats.matches.active} active`}
        />
      </div>
      {stats.panoramas.pending_review > 0 && (
        <div className="bg-yellow-900/40 border border-yellow-700 rounded-lg p-4 text-yellow-200 text-sm">
          {stats.panoramas.pending_review} panorama(s) awaiting moderation
          review.{" "}
          <a href="/panoramas" className="underline hover:text-yellow-100">
            Review now
          </a>
        </div>
      )}
    </div>
  );
}
