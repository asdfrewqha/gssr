import { NavLink, Outlet, useNavigate } from "react-router-dom";
import api from "../api/adminClient";

const links = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/maps", label: "Maps" },
  { to: "/panoramas", label: "Panoramas" },
  { to: "/users", label: "Users" },
];

export default function Layout() {
  const navigate = useNavigate();

  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => {});
    navigate("/login");
  };

  return (
    <div className="flex min-h-screen bg-gray-950 text-gray-100">
      {/* Sidebar */}
      <aside className="w-52 bg-gray-900 flex flex-col border-r border-gray-800 shrink-0">
        <div className="px-5 py-4 border-b border-gray-800">
          <span className="font-bold text-indigo-400 text-lg">GSSR Admin</span>
        </div>
        <nav className="flex-1 py-3 space-y-0.5">
          {links.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `block px-5 py-2.5 text-sm rounded-md mx-2 transition-colors ${
                  isActive
                    ? "bg-indigo-600 text-white font-medium"
                    : "text-gray-300 hover:bg-gray-800"
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-800">
          <button
            onClick={logout}
            className="w-full text-sm text-gray-400 hover:text-red-400 transition-colors text-left"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
