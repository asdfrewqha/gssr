import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import client from "../api/client";

interface LeaderboardEntry {
  rank: number;
  id: string;
  username: string;
  avatar_url: string;
  elo: number;
  xp: number;
}

type LBType = "elo" | "xp";

const medals: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export default function Leaderboard() {
  const [type, setType] = useState<LBType>("elo");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    client
      .get<LeaderboardEntry[]>(`/api/leaderboard?type=${type}`)
      .then((r) => setEntries(r.data))
      .finally(() => setLoading(false));
  }, [type]);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Leaderboard</h1>
          <Link
            to="/"
            className="text-gray-400 hover:text-white text-sm transition-colors"
          >
            ← Back
          </Link>
        </div>

        {/* Type tabs */}
        <div className="flex gap-2 bg-gray-800 p-1 rounded-lg w-fit">
          {(["elo", "xp"] as LBType[]).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                type === t
                  ? "bg-indigo-600 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {t === "elo" ? "Multiplayer ELO" : "Solo XP"}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center text-gray-500 py-12">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            No verified players yet.
          </div>
        ) : (
          <div className="bg-gray-800 rounded-2xl overflow-hidden">
            {entries.map((e) => (
              <Link
                key={e.id}
                to={`/users/${e.id}`}
                className="flex items-center gap-4 px-5 py-3 border-b border-gray-700 last:border-0 hover:bg-gray-700/50 transition-colors"
              >
                <span className="w-8 text-center text-lg">
                  {medals[e.rank] ?? (
                    <span className="text-gray-500 text-sm font-mono">
                      {e.rank}
                    </span>
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{e.username}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-indigo-400">
                    {type === "elo" ? e.elo : e.xp.toLocaleString()}
                  </p>
                  <p className="text-gray-500 text-xs">
                    {type === "elo" ? "ELO" : "XP"}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
