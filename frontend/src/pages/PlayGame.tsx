import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import client from "../api/client";
import { PanoramaViewer } from "../components/PanoramaViewer";
import { GuessMap } from "../components/GuessMap";
import { FloorSelector } from "../components/FloorSelector";

interface Floor {
  id: string;
  floor_number: number;
  label: string;
  image_url: string;
}

interface SessionState {
  session_id: string;
  map_id: string;
  pano_id: string;
  round: number;
  total_rounds: number;
  total_score: number;
  time_limit_sec: number;
  difficulty: string;
}

interface GuessResult {
  score: number;
  distance: number;
  correct_location: { x: number; y: number; floor_id: string };
  total_score: number;
  next_pano_id?: string;
  round?: number;
  xp_gained?: number;
  finished: boolean;
  community: { avg_score: number; avg_distance: number; total_guesses: number };
}

type RoundPhase = "guessing" | "result";

export default function PlayGame() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<SessionState | null>(null);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [selectedFloor, setSelectedFloor] = useState("");
  const [pendingGuess, setPendingGuess] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [phase, setPhase] = useState<RoundPhase>("guessing");
  const [result, setResult] = useState<GuessResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Key for localStorage: stores unix-ms when current round started.
  const roundStartKey = (round: number) => `pano_rs_${sessionId}_${round}`;

  // Load session + map floors on mount.
  useEffect(() => {
    if (!sessionId) return;
    client
      .get<SessionState>(`/api/solo/${sessionId}`)
      .then(async (r) => {
        const s = r.data;
        setSession(s);
        // Compute remaining time — preserve timer across page reloads.
        const key = roundStartKey(s.round);
        const stored = localStorage.getItem(key);
        if (stored) {
          const elapsed = Math.floor((Date.now() - parseInt(stored)) / 1000);
          setTimeLeft(Math.max(0, s.time_limit_sec - elapsed));
        } else {
          localStorage.setItem(key, String(Date.now()));
          setTimeLeft(s.time_limit_sec);
        }
        // Fetch floors for the map.
        if (s.map_id) {
          const mapRes = await client.get<{ floors: Floor[] }>(
            `/api/maps/${s.map_id}`,
          );
          const f = mapRes.data.floors ?? [];
          setFloors(f);
          if (f.length > 0) setSelectedFloor(f[0].id);
        }
        setLoading(false);
      })
      .catch(() => navigate("/"));
  }, [sessionId, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown timer — starts from current timeLeft (set by load effect or continueGame).
  useEffect(() => {
    if (phase !== "guessing" || !session || loading) return;
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(timerRef.current!);
          // Auto-submit with current guess (or empty).
          submitGuessRef.current?.();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, [session?.round, phase, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitGuessRef = useRef<(() => void) | null>(null);

  const submitGuess = useCallback(async () => {
    if (!sessionId || !session || submitting) return;
    clearInterval(timerRef.current!);
    setSubmitting(true);
    try {
      const r = await client.post<GuessResult>(`/api/solo/${sessionId}/guess`, {
        x: pendingGuess?.x ?? 0,
        y: pendingGuess?.y ?? 0,
        floor_id: selectedFloor,
      });
      setResult(r.data);
      setPhase("result");
      if (r.data.correct_location?.floor_id) {
        setSelectedFloor(r.data.correct_location.floor_id);
      }
    } catch {
      // ignore
    } finally {
      setSubmitting(false);
    }
  }, [sessionId, session, pendingGuess, selectedFloor, submitting]);

  // Keep the ref in sync.
  submitGuessRef.current = submitGuess;

  const continueGame = () => {
    if (!result || !session) return;
    if (result.finished) {
      navigate(`/play/${sessionId}/result`);
      return;
    }
    // Store start time for the new round so re-entry computes correct remaining time.
    const nextRound = result.round!;
    localStorage.setItem(roundStartKey(nextRound), String(Date.now()));
    setTimeLeft(session.time_limit_sec);
    // Advance to next round.
    setSession((s) =>
      s
        ? {
            ...s,
            pano_id: result.next_pano_id!,
            round: nextRound,
            total_score: result.total_score,
          }
        : s,
    );
    setPendingGuess(null);
    setResult(null);
    setPhase("guessing");
    setShowMap(false);
  };

  if (loading || !session) {
    return (
      <div className="w-screen h-screen bg-black flex items-center justify-center text-white">
        Loading…
      </div>
    );
  }

  const timerPct =
    session.time_limit_sec > 0 ? (timeLeft / session.time_limit_sec) * 100 : 0;
  const activeFloor = floors.find((f) => f.id === selectedFloor);
  const correctLoc = result
    ? {
        x: result.correct_location.x,
        y: result.correct_location.y,
        floorId: result.correct_location.floor_id,
      }
    : null;

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden">
      {/* Panorama viewer */}
      <div className="w-full h-full">
        <PanoramaViewer panoId={session.pano_id} />
      </div>

      {/* Top HUD */}
      <div className="absolute top-0 left-0 right-0 flex items-center gap-3 px-4 py-3 bg-gradient-to-b from-black/70 to-transparent z-10">
        <span className="text-white text-sm font-mono">
          {session.round}/{session.total_rounds}
        </span>
        <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${
              timeLeft < 10 ? "bg-red-500" : "bg-indigo-500"
            }`}
            style={{ width: `${timerPct}%` }}
          />
        </div>
        <span
          className={`text-sm font-mono w-8 text-right ${timeLeft < 10 ? "text-red-400" : "text-white"}`}
        >
          {timeLeft}s
        </span>
        <span className="text-gray-400 text-xs ml-2 capitalize">
          {session.difficulty}
        </span>
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-0 left-0 right-0 px-4 py-3 flex items-end gap-2 bg-gradient-to-t from-black/70 to-transparent z-10">
        {floors.length > 0 && (
          <FloorSelector
            floors={floors}
            selected={selectedFloor}
            onChange={setSelectedFloor}
          />
        )}
        <div className="flex-1" />
        {phase === "guessing" && (
          <>
            <button
              onClick={() => setShowMap((v) => !v)}
              className="bg-gray-800/90 hover:bg-gray-700 text-white rounded px-3 py-2 text-sm transition-colors"
            >
              {showMap ? "Close map" : "Open map"}
            </button>
            <button
              disabled={!pendingGuess || submitting}
              onClick={submitGuess}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded px-5 py-2 font-medium transition-colors"
            >
              {submitting ? "…" : "Submit"}
            </button>
          </>
        )}
      </div>

      {/* Guess map popup */}
      {(showMap || phase === "result") && (
        <div className="absolute bottom-16 right-4 w-72 h-52 z-20 rounded-xl overflow-hidden shadow-2xl border border-gray-600">
          <GuessMap
            floorImageUrl={
              activeFloor
                ? `${import.meta.env.VITE_S3_URL ?? ""}${activeFloor.image_url}`
                : ""
            }
            onGuess={(x, y) => {
              if (phase === "guessing") setPendingGuess({ x, y });
            }}
            guess={pendingGuess}
            correctLocation={phase === "result" ? correctLoc : null}
          />
        </div>
      )}

      {/* Round result overlay */}
      {phase === "result" && result && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60">
          <div className="bg-gray-800 rounded-2xl p-6 w-full max-w-sm space-y-4 mx-4">
            <h2 className="text-xl font-bold text-white text-center">
              Round {session.round} / {session.total_rounds}
            </h2>

            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="bg-gray-700 rounded-lg p-3">
                <p className="text-2xl font-bold text-indigo-400">
                  {result.score.toLocaleString()}
                </p>
                <p className="text-gray-400 text-xs mt-1">Your score</p>
              </div>
              <div className="bg-gray-700 rounded-lg p-3">
                <p className="text-2xl font-bold text-white">
                  {(result.distance / 10).toFixed(1)}%
                </p>
                <p className="text-gray-400 text-xs mt-1">Distance</p>
              </div>
            </div>

            {result.community.total_guesses > 0 && (
              <div className="bg-gray-700/50 rounded-lg p-3 text-center">
                <p className="text-gray-400 text-xs mb-1">
                  Community average (30d)
                </p>
                <p className="text-white text-sm">
                  Score: {result.community.avg_score.toLocaleString()} · Dist:{" "}
                  {(result.community.avg_distance / 10).toFixed(1)}% ·{" "}
                  {result.community.total_guesses} guesses
                </p>
              </div>
            )}

            <div className="text-center text-gray-400 text-sm">
              Total:{" "}
              <span className="text-white font-semibold">
                {result.total_score.toLocaleString()}
              </span>
            </div>

            <button
              onClick={continueGame}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded py-2 transition-colors"
            >
              {result.finished ? "See results" : "Next round →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
