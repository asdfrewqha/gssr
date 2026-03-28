import { Link } from "react-router-dom";

export default function VerifyEmail() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="bg-gray-800 p-8 rounded-xl w-full max-w-sm space-y-4 text-center">
        <div className="text-5xl">✅</div>
        <h1 className="text-xl font-bold text-white">Email verified!</h1>
        <p className="text-gray-400 text-sm">
          Your email address has been confirmed. You can now appear on the
          leaderboard and join multiplayer games.
        </p>
        <Link
          to="/"
          className="block w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded py-2 transition-colors"
        >
          Go to lobby
        </Link>
      </div>
    </div>
  );
}
