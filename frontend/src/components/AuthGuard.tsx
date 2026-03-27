import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import client from "../api/client";

export default function AuthGuard() {
  const [checked, setChecked] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    client
      .get("/api/users/me")
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false))
      .finally(() => setChecked(true));
  }, []);

  if (!checked)
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
        Loading…
      </div>
    );

  return authed ? <Outlet /> : <Navigate to="/login" replace />;
}
