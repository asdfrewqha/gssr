import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  xp: number;
  email_verified: boolean;
}

type Tab = "solo" | "multiplayer";
type Difficulty = "easy" | "normal" | "hard";

const difficultyMeta: Record<
  Difficulty,
  { label: string; desc: string; color: string }
> = {
  easy: {
    label: "Easy",
    desc: "120s · generous scoring",
    color: "bg-green-600 hover:bg-green-700",
  },
  normal: {
    label: "Normal",
    desc: "60s · standard scoring",
    color: "bg-yellow-600 hover:bg-yellow-700",
  },
  hard: {
    label: "Hard",
    desc: "30s · strict scoring",
    color: "bg-red-600 hover:bg-red-700",
  },
};

export default function Lobby() {
  const navigate = useNavigate();
  const reset = useGameStore((s) => s.reset);
  const setRoom = useGameStore((s) => s.setRoom);

  const [tab, setTab] = useState<Tab>("solo");
  const [maps, setMaps] = useState<MapItem[]>([]);
  const [selectedMapId, setSelectedMapId] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [soloRounds, setSoloRounds] = useState(5);
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

  const startSolo = async () => {
    if (!selectedMapId) return;
    setError("");
    try {
      const r = await client.post("/api/solo/start", {
        map_id: selectedMapId,
        rounds: soloRounds,
        difficulty,
      });
      const { session_id } = r.data as { session_id: string };
      navigate(`/play/${session_id}`);
    } catch (err) {
      setError(
        (err as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Failed to start game",
      );
    }
  };

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
        {/* Header */}
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold tracking-tight">GSSR</h1>
          {user && (
            <div className="flex items-center gap-4">
              <Link
                to="/leaderboard"
                className="text-gray-400 hover:text-white text-sm transition-colors"
              >
                Leaderboard
              </Link>
              <span className="text-gray-400 text-sm">
                {user.username} · ELO {user.elo} · {user.xp} XP
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

        {/* Email verification banner */}
        {user && !user.email_verified && (
          <div className="bg-yellow-900/40 border border-yellow-700 rounded-lg px-4 py-3 text-sm text-yellow-300">
            Your email is not verified — you won't appear on the leaderboard.
            Check your inbox.
          </div>
        )}

        {error && (
          <p className="text-red-400 text-sm bg-red-900/30 rounded px-3 py-2">
            {error}
          </p>
        )}

        {/* Mode tabs */}
        <div className="flex gap-2 bg-gray-800 p-1 rounded-lg w-fit">
          {(["solo", "multiplayer"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setError("");
              }}
              className={`px-5 py-2 rounded-md text-sm font-medium capitalize transition-colors ${
                tab === t
                  ? "bg-indigo-600 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Map selector (shared) */}
        {maps.length === 0 ? (
          <p className="text-gray-500 text-sm">No maps available yet.</p>
        ) : (
          <div className="bg-gray-800 rounded-xl p-4">
            <label className="block text-sm text-gray-400 mb-2">Map</label>
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
          </div>
        )}

        {tab === "solo" && (
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-xl p-5 space-y-3">
              <h2 className="font-semibold">Difficulty</h2>
              <div className="grid grid-cols-3 gap-2">
                {(
                  Object.entries(difficultyMeta) as [
                    Difficulty,
                    (typeof difficultyMeta)[Difficulty],
                  ][]
                ).map(([key, meta]) => (
                  <button
                    key={key}
                    onClick={() => setDifficulty(key)}
                    className={`rounded-lg p-3 text-sm font-medium transition-all ${
                      difficulty === key
                        ? meta.color + " text-white ring-2 ring-white/30"
                        : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    }`}
                  >
                    <span className="block font-bold">{meta.label}</span>
                    <span className="text-xs opacity-80">{meta.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-gray-800 rounded-xl p-5 space-y-3">
              <h2 className="font-semibold">Rounds</h2>
              <div className="flex items-center gap-3">
                {[3, 5, 10].map((n) => (
                  <button
                    key={n}
                    onClick={() => setSoloRounds(n)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      soloRounds === n
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={soloRounds}
                  onChange={(e) => setSoloRounds(Number(e.target.value))}
                  className="w-16 bg-gray-700 text-white rounded px-2 py-2 text-sm text-center"
                />
              </div>
            </div>

            <button
              onClick={startSolo}
              disabled={!selectedMapId}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 rounded-xl py-3 font-semibold text-lg transition-colors"
            >
              Play Solo
            </button>
          </div>
        )}

        {tab === "multiplayer" && (
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-xl p-6 space-y-4">
              <h2 className="text-lg font-semibold">Create Room</h2>
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
        )}
      </div>
    </div>
  );
}
