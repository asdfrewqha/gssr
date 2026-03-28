import { useCallback, useEffect, useState } from "react";
import api from "../api/adminClient";

interface User {
  id: string;
  username: string;
  email: string;
  elo: number;
  xp: number;
  email_verified: boolean;
  banned: boolean;
  created_at: string;
}

type StatusFilter = "all" | "active" | "banned" | "unverified";

const statusColors: Record<string, string> = {
  active: "text-green-400",
  banned: "text-red-400",
  unverified: "text-yellow-400",
};

export default function UserSearch() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ items: User[] }>("/admin/users", {
        params: {
          search: search || undefined,
          user_status: status === "all" ? undefined : status,
        },
      });
      setUsers(r.data.items ?? []);
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(fetch, 300);
    return () => clearTimeout(t);
  }, [fetch]);

  const toggleBan = async (user: User) => {
    setActionLoading(user.id);
    try {
      if (user.banned) {
        await api.put(`/admin/users/${user.id}/unban`);
      } else {
        await api.put(`/admin/users/${user.id}/ban`);
      }
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, banned: !u.banned } : u)),
      );
    } finally {
      setActionLoading(null);
    }
  };

  const userStatus = (u: User): string => {
    if (u.banned) return "banned";
    if (!u.email_verified) return "unverified";
    return "active";
  };

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">User Search</h1>

      <div className="flex gap-3">
        <input
          className="flex-1 bg-gray-800 border border-gray-700 text-white rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Search by username or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="bg-gray-800 border border-gray-700 text-white rounded px-3 py-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="banned">Banned</option>
          <option value="unverified">Unverified</option>
        </select>
      </div>

      {loading && <p className="text-gray-500 text-sm">Searching…</p>}

      {!loading && users.length === 0 && (
        <p className="text-gray-500 text-sm">No users found.</p>
      )}

      {users.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-left">
                <th className="px-4 py-3">Username</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">ELO</th>
                <th className="px-4 py-3">XP</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const st = userStatus(u);
                return (
                  <tr
                    key={u.id}
                    className="border-b border-gray-800 last:border-0 hover:bg-gray-800/40"
                  >
                    <td className="px-4 py-3 font-medium">{u.username}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {u.email || "—"}
                    </td>
                    <td className="px-4 py-3">{u.elo}</td>
                    <td className="px-4 py-3">{u.xp.toLocaleString()}</td>
                    <td
                      className={`px-4 py-3 capitalize font-medium ${statusColors[st] ?? ""}`}
                    >
                      {st}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        disabled={actionLoading === u.id}
                        onClick={() => toggleBan(u)}
                        className={`text-xs font-medium px-3 py-1 rounded transition-colors ${
                          u.banned
                            ? "bg-green-700 hover:bg-green-600 text-white"
                            : "bg-red-700 hover:bg-red-600 text-white"
                        } disabled:opacity-50`}
                      >
                        {u.banned ? "Unban" : "Ban"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
