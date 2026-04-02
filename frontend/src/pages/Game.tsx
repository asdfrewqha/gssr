import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import client from "../api/client";
import { useGameStore } from "../store/gameStore";
import { useSocket } from "../hooks/useSocket";
import { PanoramaViewer } from "../components/PanoramaViewer";
import { GuessMap } from "../components/GuessMap";
import { FloorSelector } from "../components/FloorSelector";
import { RoundResults } from "../components/RoundResults";

interface Floor {
  id: string;
  floor_number: number;
  label: string;
  image_url: string;
  pano_count: number;
}

export default function Game() {
  const { id: roomId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const status = useGameStore((s) => s.status);
  const currentPanoId = useGameStore((s) => s.currentPanoId);
  const mapId = useGameStore((s) => s.mapId);
  const timeLimitSec = useGameStore((s) => s.timeLimitSec);
  const currentRound = useGameStore((s) => s.currentRound);
  const totalRounds = useGameStore((s) => s.totalRounds);
  const correctLocation = useGameStore((s) => s.correctLocation);
  const setMyGuess = useGameStore((s) => s.setMyGuess);
  const setRoom = useGameStore((s) => s.setRoom);
  const setPlayers = useGameStore((s) => s.setPlayers);

  useSocket(roomId ?? null);

  // On page refresh the Zustand store is empty. Restore room state from the
  // API so the socket can rejoin and receive the next round_started event.
  useEffect(() => {
    if (currentPanoId || !roomId) return;
    client
      .get<{
        id: string;
        map_id: string;
        status: string;
        rounds: number;
        players: {
          user_id: string;
          username: string;
          elo: number;
          has_guessed: boolean;
        }[];
      }>(`/api/rooms/${roomId}`)
      .then(({ data: r }) => {
        if (r.status === "finished") {
          navigate(`/room/${roomId}/over`, { replace: true });
          return;
        }
        if (r.status !== "active") {
          navigate(`/room/${roomId}`, { replace: true });
          return;
        }
        setRoom(r.id, r.map_id);
        useGameStore.setState({ totalRounds: r.rounds });
        setPlayers(
          r.players.map((p) => ({
            userId: p.user_id,
            username: p.username,
            elo: p.elo,
            hasGuessed: p.has_guessed,
          })),
        );
      })
      .catch(() => navigate("/", { replace: true }));
  }, [roomId, currentPanoId, setRoom, setPlayers, navigate]);

  const [showMap, setShowMap] = useState(false);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [selectedFloor, setSelectedFloor] = useState("");
  const [pendingGuess, setPendingGuess] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [timeLeft, setTimeLeft] = useState(timeLimitSec);
  const [showResults, setShowResults] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Fetch floors for the map
  useEffect(() => {
    if (!mapId) return;
    client.get<{ floors: Floor[] }>(`/api/maps/${mapId}`).then((r) => {
      const f = r.data.floors;
      setFloors(f);
      if (f.length > 0) setSelectedFloor(f[0].id);
    });
  }, [mapId]);

  // Reset per-round state on new round
  useEffect(() => {
    setSubmitted(false);
    setPendingGuess(null);
    setShowResults(false);
    setShowMap(false);
    setTimeLeft(timeLimitSec);
  }, [currentRound, timeLimitSec]);

  // Countdown timer (restarts each round)
  useEffect(() => {
    if (status !== "round_active" || submitted) return;
    const id = setInterval(() => setTimeLeft((t) => Math.max(0, t - 1)), 1000);
    return () => clearInterval(id);
  }, [currentRound, status, submitted]);

  // Show results overlay when round ends
  useEffect(() => {
    if (status === "round_results") {
      setShowResults(true);
      // Switch floor to correct location's floor so the marker is visible
      if (correctLocation?.floorId) setSelectedFloor(correctLocation.floorId);
    }
  }, [status, correctLocation]);

  // Navigate to game-over screen
  useEffect(() => {
    if (status === "game_over") {
      navigate(`/room/${roomId}/over`, { replace: true });
    }
  }, [status, navigate, roomId]);

  const submitGuess = async () => {
    if (!pendingGuess || !selectedFloor || submitted) return;
    try {
      await client.post(`/api/rooms/${roomId}/guess`, {
        x: pendingGuess.x,
        y: pendingGuess.y,
        floor_id: selectedFloor,
      });
      setMyGuess({ ...pendingGuess, floorId: selectedFloor });
      setSubmitted(true);
    } catch {
      /* ignore – server timer will close the round */
    }
  };

  const activeFloor = floors.find((f) => f.id === selectedFloor);
  const timerPct = timeLimitSec > 0 ? (timeLeft / timeLimitSec) * 100 : 0;

  if (!currentPanoId)
    return (
      <div className="w-screen h-screen bg-black flex flex-col items-center justify-center text-white gap-3">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-sm">
          Reconnecting… waiting for next round
        </p>
      </div>
    );

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden">
      {/* Panorama viewer */}
      <div className="w-full h-full">
        <PanoramaViewer panoId={currentPanoId} />
      </div>

      {/* Top HUD */}
      <div className="absolute top-0 left-0 right-0 flex items-center gap-3 px-4 py-3 bg-gradient-to-b from-black/70 to-transparent z-10">
        <span className="text-white text-sm font-mono">
          {currentRound}/{totalRounds}
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
          className={`text-sm font-mono w-8 text-right ${
            timeLeft < 10 ? "text-red-400" : "text-white"
          }`}
        >
          {timeLeft}s
        </span>
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-0 left-0 right-0 px-4 py-3 flex items-end gap-2 bg-gradient-to-t from-black/70 to-transparent z-10">
        <FloorSelector
          floors={floors}
          selected={selectedFloor}
          onChange={setSelectedFloor}
        />
        <div className="flex-1" />
        {!submitted ? (
          <>
            <button
              onClick={() => setShowMap((v) => !v)}
              className="bg-gray-800/90 hover:bg-gray-700 text-white rounded px-3 py-2 text-sm transition-colors"
            >
              {showMap ? "Close map" : "Open map"}
            </button>
            <button
              disabled={!pendingGuess || !selectedFloor}
              onClick={submitGuess}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded px-5 py-2 font-medium transition-colors"
            >
              Submit
            </button>
          </>
        ) : (
          <span className="text-gray-400 text-sm">Waiting for others…</span>
        )}
      </div>

      {/* Guess map popup */}
      {(showMap || showResults) && activeFloor && (
        <div
          key={activeFloor.id}
          className="absolute bottom-16 right-4 w-72 h-52 z-20 rounded-xl overflow-hidden shadow-2xl border border-gray-600"
        >
          <GuessMap
            floorImageUrl={`${import.meta.env.VITE_S3_URL ?? ""}${activeFloor.image_url}`}
            onGuess={(x, y) => {
              if (!submitted) setPendingGuess({ x, y });
            }}
            guess={pendingGuess}
            correctLocation={showResults ? correctLocation : null}
          />
        </div>
      )}

      {/* Round results overlay */}
      {showResults && <RoundResults onDismiss={() => setShowResults(false)} />}
    </div>
  );
}
