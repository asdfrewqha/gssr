import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AuthGuard from "./components/AuthGuard";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import MapDetail from "./pages/MapDetail";
import Maps from "./pages/Maps";
import Panoramas from "./pages/Panoramas";
import Users from "./pages/Users";

export default function App() {
  return (
    <BrowserRouter>
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
          <Route path="/panoramas" element={<Panoramas />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
