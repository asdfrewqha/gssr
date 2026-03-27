import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import client from "../api/client";
import { useGameStore } from "../store/gameStore";

interface MapItem {
  id: string;
  name: string;
  description: string;
}

interface UserInfo {
  id: string;
  username: string;
  elo: number;
}

export default function Lobby() {
  const navigate = useNavigate();
  const reset = useGameStore((s) => s.reset);
  const setRoom = useGameStore((s) => s.setRoom);

  const [maps, setMaps] = useState<MapItem[]>([]);
  const [selectedMapId, setSelectedMapId] = useState("");
  const [rounds, setRounds] = useState(5);
  const [timeLimitSec, setTimeLimitSec] = useState(60);
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [joinId, setJoinId] = useState("");
  const [error, setError] = useState("");
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    reset();
    Promise.all([client.get("/api/maps"), client.get("/api/users/me")]).then(
      ([mapsRes, userRes]) => {
        const m: MapItem[] = mapsRes.data;
        setMaps(m);
        if (m.length > 0) setSelectedMapId(m[0].id);
        setUser(userRes.data);
      },
    );
  }, [reset]);

  const createRoom = async () => {
    if (!selectedMapId) return;
    setError("");
    try {
      const r = await client.post("/api/rooms", {
        map_id: selectedMapId,
        max_players: maxPlayers,
        rounds,
        time_limit_sec: timeLimitSec,
      });
      const room = r.data as { id: string; map_id: string; rounds: number };
      setRoom(room.id, room.map_id);
      useGameStore.setState({ totalRounds: room.rounds });
      navigate(`/room/${room.id}`);
    } catch (err) {
      setError(
        (err as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Failed to create room",
      );
    }
  };

  const joinRoom = async () => {
    if (!joinId.trim()) return;
    setError("");
    try {
      const r = await client.post(`/api/rooms/${joinId.trim()}/join`);
      const room = r.data as { id: string; map_id: string; rounds: number };
      setRoom(room.id, room.map_id);
      useGameStore.setState({ totalRounds: room.rounds });
      navigate(`/room/${room.id}`);
    } catch (err) {
      setError(
        (err as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Room not found",
      );
    }
  };

  const logout = async () => {
    await client.post("/api/auth/logout").catch(() => {});
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold tracking-tight">GSSR</h1>
          {user && (
            <div className="flex items-center gap-4">
              <span className="text-gray-400 text-sm">
                {user.username} · ELO {user.elo}
              </span>
              <button
                onClick={logout}
                className="text-gray-500 hover:text-red-400 text-sm transition-colors"
              >
                Logout
              </button>
            </div>
          )}
        </div>

        {error && (
          <p className="text-red-400 text-sm bg-red-900/30 rounded px-3 py-2">
            {error}
          </p>
        )}

        {/* Create room */}
        <div className="bg-gray-800 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Create Room</h2>
          {maps.length === 0 ? (
            <p className="text-gray-500 text-sm">No maps available yet.</p>
          ) : (
            <select
              className="w-full bg-gray-700 text-white rounded px-3 py-2"
              value={selectedMapId}
              onChange={(e) => setSelectedMapId(e.target.value)}
            >
              {maps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          <div className="grid grid-cols-3 gap-3">
            {(
              [
                {
                  label: "Rounds",
                  min: 1,
                  max: 20,
                  val: rounds,
                  set: setRounds,
                },
                {
                  label: "Time (s)",
                  min: 10,
                  max: 300,
                  val: timeLimitSec,
                  set: setTimeLimitSec,
                },
                {
                  label: "Max players",
                  min: 2,
                  max: 16,
                  val: maxPlayers,
                  set: setMaxPlayers,
                },
              ] as const
            ).map(({ label, min, max, val, set }) => (
              <label key={label} className="block text-sm text-gray-400">
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  value={val}
                  onChange={(e) => set(Number(e.target.value))}
                  className="w-full bg-gray-700 text-white rounded px-3 py-2 mt-1"
                />
              </label>
            ))}
          </div>
          <button
            onClick={createRoom}
            disabled={!selectedMapId}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 rounded py-2 font-medium transition-colors"
          >
            Create
          </button>
        </div>

        {/* Join room */}
        <div className="bg-gray-800 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Join Room</h2>
          <div className="flex gap-3">
            <input
              className="flex-1 bg-gray-700 text-white rounded px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Room ID"
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && joinRoom()}
            />
            <button
              onClick={joinRoom}
              className="bg-green-600 hover:bg-green-700 rounded px-6 py-2 font-medium transition-colors"
            >
              Join
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
