/**
 * Axios client with JWT interceptors and 401 → redirect to login.
 */
import axios, { type AxiosInstance, type AxiosResponse } from "axios";

const BASE_URL = "/api/v1";

const client: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
  withCredentials: true, // Pour le cookie refresh_token httpOnly
});

// ── Request interceptor: inject Bearer token ─────────────────────────────────
client.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor: 401 → refresh or redirect ──────────────────────────
let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

client.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve) => {
          refreshQueue.push((token: string) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(client(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const resp = await axios.post(`${BASE_URL}/auth/refresh`, {}, { withCredentials: true });
        const newToken: string = resp.data.access_token;
        localStorage.setItem("access_token", newToken);

        refreshQueue.forEach((cb) => cb(newToken));
        refreshQueue = [];

        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return client(originalRequest);
      } catch {
        localStorage.removeItem("access_token");
        window.location.href = "/login";
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default client;
