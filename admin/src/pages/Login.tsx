import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/adminClient";

export default function Login() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.post("/api/auth/admin-login", form);
      navigate("/dashboard");
    } catch (err) {
      setError(
        (err as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Login failed",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <form
        onSubmit={submit}
        className="bg-gray-900 border border-gray-800 p-8 rounded-xl w-full max-w-sm space-y-4"
      >
        <h1 className="text-2xl font-bold text-white text-center">
          GSSR Admin
        </h1>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <input
          className="w-full bg-gray-800 text-white rounded px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Username"
          value={form.username}
          onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
          required
          autoComplete="username"
        />
        <input
          type="password"
          className="w-full bg-gray-800 text-white rounded px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Password"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          required
          autoComplete="current-password"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded py-2 disabled:opacity-50 transition-colors"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
