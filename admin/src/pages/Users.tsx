import { useEffect, useRef, useState } from "react";
import api from "../api/adminClient";

interface User {
  id: string;
  username: string;
  email: string;
  email_verified: boolean;
  elo: number;
  xp: number;
  banned: boolean;
  created_at: string;
}

const STATUS_FILTERS = ["all", "active", "banned", "unverified"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pendingNew, setPendingNew] = useState(0);
  const perPage = 50;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live registration feed via WebSocket
  useEffect(() => {
    const base = import.meta.env.VITE_API_BASE || "";
    const wsBase = base
      ? base.replace(/^http/, "ws")
      : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
    const ws = new WebSocket(`${wsBase}/admin/ws/users`);
    ws.onmessage = () => setPendingNew((n) => n + 1);
    ws.onerror = () => ws.close();
    return () => ws.close();
  }, []);

  const load = (s: string, f: StatusFilter, p: number) => {
    setLoading(true);
    api
      .get<{ items: User[]; total: number }>("/admin/users", {
        params: {
          search: s || undefined,
          user_status: f === "all" ? undefined : f,
          page: p,
          per_page: perPage,
        },
      })
      .then((r) => {
        setUsers(r.data.items);
        setTotal(r.data.total);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(search, statusFilter, page);
  }, [statusFilter, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSearchChange = (v: string) => {
    setSearch(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      load(v, statusFilter, 1);
    }, 300);
  };

  const onFilterChange = (f: StatusFilter) => {
    setStatusFilter(f);
    setPage(1);
  };

  const ban = async (id: string, banned: boolean) => {
    await api.put(`/admin/users/${id}/${banned ? "unban" : "ban"}`);
    load(search, statusFilter, page);
  };

  const deleteUser = async (id: string, username: string) => {
    if (
      !confirm(`Delete user "${username}" permanently? This cannot be undone.`)
    )
      return;
    await api.delete(`/admin/users/${id}`);
    load(search, statusFilter, page);
  };

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-white">Users</h1>
        {pendingNew > 0 && (
          <button
            onClick={() => {
              setPendingNew(0);
              setPage(1);
              load(search, statusFilter, 1);
            }}
            className="text-xs bg-indigo-900 border border-indigo-600 text-indigo-300 px-3 py-1 rounded hover:bg-indigo-800 transition-colors"
          >
            +{pendingNew} new — refresh
          </button>
        )}
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Search by username or email…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="bg-gray-800 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-2 focus:ring-indigo-500 w-64"
        />
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => onFilterChange(f)}
              className={`px-3 py-1.5 text-xs rounded capitalize transition-colors ${
                statusFilter === f
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-500 ml-auto">{total} users</span>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        {loading ? (
          <p className="text-gray-400 p-6 text-sm">Loading…</p>
        ) : users.length === 0 ? (
          <p className="text-gray-500 p-6 text-sm">No users found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">Username</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">ELO</th>
                <th className="px-4 py-3 font-medium">XP</th>
                <th className="px-4 py-3 font-medium">Verified</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Joined</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30"
                >
                  <td className="px-4 py-2 font-medium text-white">
                    {u.username}
                  </td>
                  <td className="px-4 py-2 text-gray-400 text-xs">
                    {u.email ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-gray-300">{u.elo}</td>
                  <td className="px-4 py-2 text-gray-300">{u.xp}</td>
                  <td className="px-4 py-2">
                    {u.email_verified ? (
                      <span className="text-green-400 text-xs">verified</span>
                    ) : (
                      <span className="text-yellow-500 text-xs">pending</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {u.banned ? (
                      <span className="text-red-400 text-xs">banned</span>
                    ) : (
                      <span className="text-green-400 text-xs">active</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-500 text-xs">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2 text-right space-x-3">
                    <button
                      onClick={() => ban(u.id, u.banned)}
                      className={`text-xs ${u.banned ? "text-green-500 hover:text-green-400" : "text-yellow-500 hover:text-yellow-400"}`}
                    >
                      {u.banned ? "Unban" : "Ban"}
                    </button>
                    <button
                      onClick={() => deleteUser(u.id, u.username)}
                      className="text-xs text-red-500 hover:text-red-400"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex gap-2 justify-center">
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1 text-sm bg-gray-800 text-gray-300 rounded disabled:opacity-40 hover:bg-gray-700"
          >
            ← Prev
          </button>
          <span className="px-3 py-1 text-sm text-gray-400">
            {page} / {totalPages}
          </span>
          <button
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 text-sm bg-gray-800 text-gray-300 rounded disabled:opacity-40 hover:bg-gray-700"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
