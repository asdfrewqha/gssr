import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import client from "../api/client";
import { useGameStore } from "../store/gameStore";
import { useWebSocket } from "../hooks/useWebSocket";

interface RoomApiPlayer {
  user_id: string;
  username: string;
  elo: number;
  has_guessed: boolean;
}

interface RoomApiData {
  id: string;
  host_id: string;
  map_id: string;
  players: RoomApiPlayer[];
  status: string;
  rounds: number;
  time_limit_sec: number;
}

export default function Room() {
  const { id: roomId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const status = useGameStore((s) => s.status);
  const storePlayers = useGameStore((s) => s.players);
  const setRoom = useGameStore((s) => s.setRoom);
  const setPlayers = useGameStore((s) => s.setPlayers);

  useWebSocket(roomId ?? null);

  const [roomData, setRoomData] = useState<RoomApiData | null>(null);
  const [myUserId, setMyUserId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!roomId) return;
    Promise.all([
      client.get<RoomApiData>(`/api/rooms/${roomId}`),
      client.get<{ id: string }>("/api/users/me"),
    ])
      .then(([roomRes, userRes]) => {
        const room = roomRes.data;
        setRoomData(room);
        setMyUserId(userRes.data.id);
        setRoom(room.id, room.map_id);
        useGameStore.setState({ totalRounds: room.rounds });
        setPlayers(
          room.players.map((p) => ({
            userId: p.user_id,
            username: p.username,
            elo: p.elo,
            hasGuessed: p.has_guessed,
          })),
        );
      })
      .catch(() => setError("Room not found"));
  }, [roomId, setRoom, setPlayers]);

  // Navigate to game when a round starts
  useEffect(() => {
    if (status === "round_active") {
      navigate(`/room/${roomId}/play`, { replace: true });
    }
  }, [status, roomId, navigate]);

  const startGame = () => {
    client.post(`/api/rooms/${roomId}/start`).catch((e: unknown) => {
      setError(
        (e as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Failed to start",
      );
    });
  };

  const leave = async () => {
    await client.delete(`/api/rooms/${roomId}/leave`).catch(() => {});
    navigate("/");
  };

  const copyId = () => {
    if (roomId) navigator.clipboard.writeText(roomId).catch(() => {});
  };

  if (error)
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center gap-4">
        <p className="text-red-400">{error}</p>
        <button
          onClick={() => navigate("/")}
          className="text-indigo-400 hover:underline text-sm"
        >
          Back to lobby
        </button>
      </div>
    );

  if (!roomData)
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">
        Loading…
      </div>
    );

  const isHost = roomData.host_id === myUserId;
  const players =
    storePlayers.length > 0
      ? storePlayers
      : roomData.players.map((p) => ({
          userId: p.user_id,
          username: p.username,
          elo: p.elo,
          hasGuessed: p.has_guessed,
        }));

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-xl font-semibold">Waiting room</h2>
            <button
              onClick={copyId}
              className="font-mono text-sm text-gray-400 hover:text-indigo-400 transition-colors"
              title="Click to copy"
            >
              {roomId}
            </button>
          </div>
          <button
            onClick={leave}
            className="text-gray-500 hover:text-red-400 text-sm transition-colors"
          >
            Leave
          </button>
        </div>

        {/* Room settings */}
        <div className="bg-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-sm">
            {roomData.rounds} rounds · {roomData.time_limit_sec}s each · up to{" "}
            {players.length}/{roomData.rounds} players
          </p>
        </div>

        {/* Players */}
        <div className="bg-gray-800 rounded-xl p-4 space-y-2">
          <p className="text-sm text-gray-500 font-medium uppercase tracking-wide">
            Players ({players.length})
          </p>
          {players.map((p) => (
            <div
              key={p.userId}
              className="flex justify-between items-center bg-gray-700 rounded px-3 py-2"
            >
              <span className="font-medium">
                {p.username}
                {p.userId === myUserId && (
                  <span className="ml-2 text-indigo-400 text-xs">(you)</span>
                )}
                {p.userId === roomData.host_id && (
                  <span className="ml-2 text-yellow-400 text-xs">host</span>
                )}
              </span>
              <span className="text-gray-400 text-sm">ELO {p.elo}</span>
            </div>
          ))}
        </div>

        {/* Start / waiting */}
        {isHost ? (
          <button
            onClick={startGame}
            disabled={players.length < 1}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 rounded py-3 font-medium text-lg transition-colors"
          >
            Start Game
          </button>
        ) : (
          <p className="text-center text-gray-400 text-sm">
            Waiting for host to start…
          </p>
        )}
      </div>
    </div>
  );
}
