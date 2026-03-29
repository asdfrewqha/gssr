import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import api from "../api/adminClient";

interface Me {
  id: string;
  username: string;
  is_admin: boolean;
}

interface Props {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: Props) {
  const [state, setState] = useState<"loading" | "ok" | "unauth" | "forbidden">(
    "loading",
  );
  const location = useLocation();

  useEffect(() => {
    api
      .get<Me>("/api/users/me")
      .then((res) => setState(res.data.is_admin ? "ok" : "forbidden"))
      .catch(() => setState("unauth"));
  }, []);

  if (state === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <span className="text-gray-400">Loading…</span>
      </div>
    );
  }
  if (state === "unauth")
    return <Navigate to="/login" state={{ from: location }} replace />;
  if (state === "forbidden") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="text-center space-y-3">
          <p className="text-red-400">You are logged in as a regular user.</p>
          <a
            href="#/login"
            className="text-indigo-400 hover:text-indigo-300 text-sm underline"
          >
            Go to Admin Login →
          </a>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
