import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/adminClient";

interface MapRow {
  id: string;
  name: string;
  description: string;
  floor_count: number;
  coord_type: string;
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
}

interface CreateForm {
  name: string;
  description: string;
  x_min: string;
  x_max: string;
  y_min: string;
  y_max: string;
  coord_type: string;
}

const emptyForm: CreateForm = {
  name: "",
  description: "",
  x_min: "0",
  x_max: "1000",
  y_min: "0",
  y_max: "1000",
  coord_type: "pixels",
};

export default function Maps() {
  const [maps, setMaps] = useState<MapRow[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = () =>
    api.get<MapRow[]>("/admin/maps").then((r) => setMaps(r.data));

  useEffect(() => {
    load();
  }, []);

  const field =
    (k: keyof CreateForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post("/admin/maps", {
        name: form.name,
        description: form.description || undefined,
        x_min: parseFloat(form.x_min),
        x_max: parseFloat(form.x_max),
        y_min: parseFloat(form.y_min),
        y_max: parseFloat(form.y_max),
        coord_type: form.coord_type,
      });
      setForm(emptyForm);
      setShowCreate(false);
      load();
    } catch (err) {
      setError(
        (err as { response?: { data?: { detail?: string } } }).response?.data
          ?.detail ?? "Error",
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteMap = async (id: string, name: string) => {
    if (!confirm(`Delete map "${name}"? This cannot be undone.`)) return;
    await api.delete(`/admin/maps/${id}`);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Maps</h1>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-2 rounded-lg transition-colors"
        >
          {showCreate ? "Cancel" : "+ New Map"}
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={create}
          className="bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-3"
        >
          <h2 className="font-semibold text-white">Create Map</h2>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-gray-400">Name</label>
              <input
                className="mt-1 w-full bg-gray-800 text-white rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.name}
                onChange={field("name")}
                required
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-400">Description</label>
              <input
                className="mt-1 w-full bg-gray-800 text-white rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.description}
                onChange={field("description")}
              />
            </div>
            {(["x_min", "x_max", "y_min", "y_max"] as const).map((k) => (
              <div key={k}>
                <label className="text-xs text-gray-400">{k}</label>
                <input
                  type="number"
                  className="mt-1 w-full bg-gray-800 text-white rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  value={form[k]}
                  onChange={field(k)}
                  required
                />
              </div>
            ))}
            <div>
              <label className="text-xs text-gray-400">Coord type</label>
              <select
                className="mt-1 w-full bg-gray-800 text-white rounded px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.coord_type}
                onChange={field("coord_type")}
              >
                <option value="pixels">pixels</option>
                <option value="geo">geo</option>
              </select>
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Create"}
          </button>
        </form>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400 text-left">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Floors</th>
              <th className="px-4 py-3 font-medium">Coords</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {maps.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  No maps yet
                </td>
              </tr>
            )}
            {maps.map((m) => (
              <tr
                key={m.id}
                className="border-b border-gray-800/50 hover:bg-gray-800/30"
              >
                <td className="px-4 py-3">
                  <Link
                    to={`/maps/${m.id}`}
                    className="text-indigo-400 hover:text-indigo-300 font-medium"
                  >
                    {m.name}
                  </Link>
                  {m.description && (
                    <p className="text-xs text-gray-500 truncate max-w-xs">
                      {m.description}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-300">{m.floor_count}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  x: {m.x_min}–{m.x_max} / y: {m.y_min}–{m.y_max}
                </td>
                <td className="px-4 py-3 text-gray-400">{m.coord_type}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => deleteMap(m.id, m.name)}
                    className="text-red-500 hover:text-red-400 text-xs"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
