import { useEffect, useState } from "react";
import api from "../api/adminClient";

interface User {
  id: string;
  username: string;
  elo: number;
  banned: boolean;
  is_admin: boolean;
  created_at: string;
}

interface UserList {
  page: number;
  per_page: number;
  total: number;
  items: User[];
}

export default function Users() {
  const [data, setData] = useState<UserList | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const load = (p: number) => {
    setLoading(true);
    api
      .get<UserList>("/admin/users", { params: { page: p, per_page: 50 } })
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(page);
  }, [page]);

  const ban = async (id: string, ban: boolean) => {
    await api.put(`/admin/users/${id}/${ban ? "ban" : "unban"}`);
    load(page);
  };

  const totalPages = data ? Math.ceil(data.total / data.per_page) : 1;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Users</h1>
      {loading && <p className="text-gray-400 text-sm">Loading…</p>}
      {data && (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-4 py-3 font-medium">Username</th>
                  <th className="px-4 py-3 font-medium">ELO</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr
                    key={u.id}
                    className={`border-b border-gray-800/50 hover:bg-gray-800/30 ${u.banned ? "opacity-50" : ""}`}
                  >
                    <td className="px-4 py-3 font-medium text-white">
                      {u.username}
                    </td>
                    <td className="px-4 py-3 text-gray-300">{u.elo}</td>
                    <td className="px-4 py-3">
                      {u.is_admin ? (
                        <span className="text-indigo-400 text-xs font-medium">
                          admin
                        </span>
                      ) : (
                        <span className="text-gray-500 text-xs">user</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {u.banned ? (
                        <span className="text-red-400 text-xs">banned</span>
                      ) : (
                        <span className="text-green-400 text-xs">active</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!u.is_admin && (
                        <button
                          onClick={() => ban(u.id, !u.banned)}
                          className={`text-xs ${
                            u.banned
                              ? "text-green-500 hover:text-green-400"
                              : "text-red-500 hover:text-red-400"
                          }`}
                        >
                          {u.banned ? "Unban" : "Ban"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-3 text-sm">
              <button
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 1}
                className="text-gray-400 hover:text-white disabled:opacity-30"
              >
                ← Prev
              </button>
              <span className="text-gray-400">
                {page} / {totalPages} ({data.total} users)
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page === totalPages}
                className="text-gray-400 hover:text-white disabled:opacity-30"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
