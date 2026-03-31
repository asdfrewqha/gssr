import axios from "axios";

// Relative base URL so vite proxy handles routing in dev.
// In production (Cloudflare Pages) set VITE_API_BASE to the backend origin.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || "",
  withCredentials: true,
});

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      try {
        await api.post("/api/auth/admin-refresh");
        return api(error.config);
      } catch {
        window.location.href = import.meta.env.BASE_URL + "#/login";
      }
    }
    return Promise.reject(error);
  },
);

export default api;
