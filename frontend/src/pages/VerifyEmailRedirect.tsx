import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Relay page: the verification email links to /verify-email?token=...
 * This page immediately forwards the token to the game service API which
 * validates it and redirects back to /verified on success.
 */
export default function VerifyEmailRedirect() {
  const [params] = useSearchParams();

  useEffect(() => {
    const token = params.get("token");
    if (token) {
      const apiBase = import.meta.env.VITE_API_URL || "";
      window.location.href = `${apiBase}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
    }
  }, [params]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <p className="text-gray-400">Verifying your email…</p>
    </div>
  );
}
