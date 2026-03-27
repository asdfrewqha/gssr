import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import client from "../api/client";

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await client.post("/api/auth/register", form);
      // Auto-login after register
      await client.post("/api/auth/login", form);
      navigate("/");
    } catch (err) {
      setError(
        (err as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Registration failed",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <form
        onSubmit={submit}
        className="bg-gray-800 p-8 rounded-xl w-full max-w-sm space-y-4"
      >
        <h1 className="text-2xl font-bold text-white text-center">GSSR</h1>
        <p className="text-gray-400 text-sm text-center">Create account</p>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <input
          className="w-full bg-gray-700 text-white rounded px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Username (3–32 chars)"
          value={form.username}
          minLength={3}
          maxLength={32}
          onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
          required
          autoComplete="username"
        />
        <input
          type="password"
          className="w-full bg-gray-700 text-white rounded px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Password (min 8 chars)"
          value={form.password}
          minLength={8}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          required
          autoComplete="new-password"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded py-2 disabled:opacity-50 transition-colors"
        >
          {loading ? "Creating account…" : "Create account"}
        </button>
        <p className="text-gray-400 text-sm text-center">
          Have an account?{" "}
          <Link to="/login" className="text-indigo-400 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
