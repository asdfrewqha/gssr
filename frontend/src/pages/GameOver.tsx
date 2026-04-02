import { useNavigate } from "react-router-dom";
import { useGameStore } from "../store/gameStore";

export default function GameOver() {
  const navigate = useNavigate();
  const players = useGameStore((s) => s.players);
  const finalScores = useGameStore((s) => s.finalScores);
  const reset = useGameStore((s) => s.reset);

  // Use server-authoritative final scores; fall back to player list if missing.
  const eloMap = Object.fromEntries(players.map((p) => [p.userId, p.elo]));
  const totals = (finalScores ?? [])
    .map((f) => ({ ...f, elo: eloMap[f.userId] ?? 0 }))
    .sort((a, b) => b.total - a.total);

  const medals = ["🥇", "🥈", "🥉"];

  const goLobby = () => {
    reset();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-xl p-8 w-full max-w-md space-y-6">
        <h2 className="text-2xl font-bold text-center">Game Over</h2>

        <div className="space-y-2">
          {totals.map((p, i) => (
            <div
              key={p.userId}
              className={`flex items-center gap-3 rounded px-4 py-3 ${
                i === 0
                  ? "bg-yellow-900/40 border border-yellow-700/40"
                  : "bg-gray-700"
              }`}
            >
              <span className="w-8 text-lg text-center">
                {medals[i] ?? `${i + 1}.`}
              </span>
              <span className="flex-1 font-medium">{p.username}</span>
              <span className="text-gray-400 text-sm">ELO {p.elo}</span>
              <span className="text-yellow-400 font-bold text-lg">
                {Math.round(p.total)}
              </span>
            </div>
          ))}
          {totals.length === 0 && (
            <p className="text-gray-500 text-center text-sm">No results.</p>
          )}
        </div>

        <button
          onClick={goLobby}
          className="w-full bg-indigo-600 hover:bg-indigo-700 rounded py-3 font-medium text-lg transition-colors"
        >
          Back to Lobby
        </button>
      </div>
    </div>
  );
}
