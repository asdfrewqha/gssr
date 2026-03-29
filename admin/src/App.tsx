import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import AuthGuard from "./components/AuthGuard";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import MapDetail from "./pages/MapDetail";
import Maps from "./pages/Maps";
import Panoramas from "./pages/Panoramas";
import Users from "./pages/Users";
import AdminManagement from "./pages/AdminManagement";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <AuthGuard>
              <Layout />
            </AuthGuard>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/maps" element={<Maps />} />
          <Route path="/maps/:id" element={<MapDetail />} />
          <Route path="/users" element={<Users />} />
          <Route path="/admins" element={<AdminManagement />} />
          <Route path="/panoramas" element={<Panoramas />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
