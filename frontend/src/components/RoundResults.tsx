import { useGameStore } from "../store/gameStore";

interface Props {
  onDismiss: () => void;
}

export function RoundResults({ onDismiss }: Props) {
  const { roundResults, players, currentRound, totalRounds } = useGameStore();
  const sorted = [...roundResults].sort((a, b) => b.score - a.score);

  return (
    <div className="absolute inset-0 bg-black/75 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-4 mx-4">
        <h3 className="text-xl font-bold text-white text-center">
          Round {currentRound} / {totalRounds} results
        </h3>
        <div className="space-y-2">
          {sorted.map((r, i) => {
            const player = players.find((p) => p.userId === r.userId);
            return (
              <div
                key={r.userId}
                className="flex items-center gap-3 bg-gray-700 rounded px-4 py-2"
              >
                <span className="text-gray-500 w-5 text-sm">{i + 1}</span>
                <span className="flex-1 text-white font-medium">
                  {player?.username ?? r.userId.slice(0, 8)}
                </span>
                <span className="text-gray-400 text-sm mr-2">
                  {r.distance.toFixed(0)} m
                </span>
                <span className="text-yellow-400 font-bold">
                  {Math.round(r.score)}
                </span>
              </div>
            );
          })}
          {sorted.length === 0 && (
            <p className="text-gray-500 text-sm text-center">
              No guesses this round.
            </p>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded py-2 font-medium transition-colors"
        >
          {currentRound < totalRounds ? "Continue…" : "See final results"}
        </button>
      </div>
    </div>
  );
}
