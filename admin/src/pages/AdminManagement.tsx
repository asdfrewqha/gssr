import { useEffect, useState } from "react";
import api from "../api/adminClient";

interface Admin {
  id: string;
  username: string;
  email?: string;
  created_at: string;
}

interface Me {
  id: string;
}

export default function AdminManagement() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [form, setForm] = useState({ username: "", password: "", email: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<Admin[]>("/admin/admins"),
      api.get<Me>("/api/users/me"),
    ]).then(([adminsRes, meRes]) => {
      setAdmins(adminsRes.data);
      setMe(meRes.data);
    });
  }, []);

  const createAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const r = await api.post<Admin>("/admin/admins", form);
      setAdmins((prev) => [...prev, r.data]);
      setForm({ username: "", password: "", email: "" });
    } catch (err) {
      setError(
        (err as { response?: { data?: { detail?: string } } }).response?.data
          ?.detail ?? "Failed to create admin",
      );
    } finally {
      setLoading(false);
    }
  };

  const deleteAdmin = async (id: string) => {
    if (!window.confirm("Delete this admin?")) return;
    setDeleteLoading(id);
    try {
      await api.delete(`/admin/admins/${id}`);
      setAdmins((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      alert(
        (err as { response?: { data?: { detail?: string } } }).response?.data
          ?.detail ?? "Failed to delete admin",
      );
    } finally {
      setDeleteLoading(null);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-xl font-bold">Admin Management</h1>

      {/* Existing admins */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-800">
          <h2 className="font-semibold text-sm text-gray-300">
            Current admins
          </h2>
        </div>
        {admins.length === 0 ? (
          <p className="px-5 py-4 text-gray-500 text-sm">No admins found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-left">
                <th className="px-5 py-3">Username</th>
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">Created</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-gray-800 last:border-0"
                >
                  <td className="px-5 py-3 font-medium">{a.username}</td>
                  <td className="px-5 py-3 text-gray-400">{a.email || "—"}</td>
                  <td className="px-5 py-3 text-gray-500">
                    {new Date(a.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {me && a.id !== me.id && (
                      <button
                        disabled={deleteLoading === a.id}
                        onClick={() => deleteAdmin(a.id)}
                        className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
                      >
                        {deleteLoading === a.id ? "…" : "Delete"}
                      </button>
                    )}
                    {me && a.id === me.id && (
                      <span className="text-xs text-gray-600">You</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create new admin */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <h2 className="font-semibold text-sm text-gray-300">Add new admin</h2>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <form onSubmit={createAdmin} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              className="bg-gray-800 border border-gray-700 text-white rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Username"
              value={form.username}
              onChange={(e) =>
                setForm((f) => ({ ...f, username: e.target.value }))
              }
              required
              minLength={3}
            />
            <input
              type="email"
              className="bg-gray-800 border border-gray-700 text-white rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Email (optional)"
              value={form.email}
              onChange={(e) =>
                setForm((f) => ({ ...f, email: e.target.value }))
              }
            />
          </div>
          <input
            type="password"
            className="w-full bg-gray-800 border border-gray-700 text-white rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Password (min 8 chars)"
            value={form.password}
            onChange={(e) =>
              setForm((f) => ({ ...f, password: e.target.value }))
            }
            required
            minLength={8}
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded px-4 py-2 disabled:opacity-50 transition-colors"
          >
            {loading ? "Creating…" : "Create admin"}
          </button>
        </form>
      </div>
    </div>
  );
}
