import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import client from "../api/client";

interface RoundBreakdown {
  round: number;
  score: number;
  distance: number;
  guess_x: number;
  guess_y: number;
  correct_x: number;
  correct_y: number;
}

interface SessionResult {
  session_id: string;
  map_name: string;
  difficulty: string;
  rounds: number;
  total_score: number;
  xp_gained: number;
  status: string;
  started_at: string;
  ended_at?: string;
  breakdown: RoundBreakdown[];
}

const difficultyColor: Record<string, string> = {
  easy: "text-green-400",
  normal: "text-yellow-400",
  hard: "text-red-400",
};

export default function PlayResult() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [result, setResult] = useState<SessionResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    client
      .get<SessionResult>(`/api/solo/${sessionId}/result`)
      .then((r) => setResult(r.data))
      .catch(() => navigate("/"))
      .finally(() => setLoading(false));
  }, [sessionId, navigate]);

  if (loading || !result) {
    return (
      <div className="w-screen h-screen bg-gray-900 flex items-center justify-center text-white">
        Loading…
      </div>
    );
  }

  const maxScore = result.rounds * 5000;
  const pct =
    maxScore > 0 ? Math.round((result.total_score / maxScore) * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Results</h1>
          <p className="text-gray-400">
            {result.map_name} ·{" "}
            <span
              className={`capitalize font-medium ${difficultyColor[result.difficulty] ?? "text-white"}`}
            >
              {result.difficulty}
            </span>
          </p>
        </div>

        {/* Score card */}
        <div className="bg-gray-800 rounded-2xl p-6 text-center space-y-3">
          <p className="text-5xl font-bold text-indigo-400">
            {result.total_score.toLocaleString()}
          </p>
          <p className="text-gray-400 text-sm">
            out of {maxScore.toLocaleString()} ({pct}%)
          </p>
          {result.xp_gained > 0 && (
            <div className="inline-block bg-indigo-900/50 text-indigo-300 px-4 py-1 rounded-full text-sm font-medium">
              +{result.xp_gained} XP earned
            </div>
          )}
        </div>

        {/* Round breakdown */}
        <div className="bg-gray-800 rounded-2xl p-5 space-y-3">
          <h2 className="font-semibold text-gray-300">Round breakdown</h2>
          {result.breakdown.map((r) => (
            <div
              key={r.round}
              className="flex items-center justify-between py-2 border-b border-gray-700 last:border-0"
            >
              <span className="text-gray-400 text-sm">Round {r.round}</span>
              <div className="text-right">
                <p className="font-semibold">
                  {r.score.toLocaleString()}{" "}
                  <span className="text-gray-500 text-xs">/ 5000</span>
                </p>
                <p className="text-gray-500 text-xs">
                  {r.distance.toFixed(0)} px
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate("/")}
            className="bg-gray-700 hover:bg-gray-600 rounded-xl py-3 font-medium transition-colors"
          >
            Back to lobby
          </button>
          <button
            onClick={() => navigate("/")}
            className="bg-indigo-600 hover:bg-indigo-700 rounded-xl py-3 font-medium transition-colors"
          >
            Play again
          </button>
        </div>
      </div>
    </div>
  );
}
