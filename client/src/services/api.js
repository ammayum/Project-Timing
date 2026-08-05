const DEFAULT_API_BASE_URL = import.meta.env.DEV ? "/api" : "/api";

function resolveApiBaseUrl() {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

  if (!configuredBaseUrl) {
    return DEFAULT_API_BASE_URL;
  }

  if (
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    configuredBaseUrl.startsWith("http://")
  ) {
    console.warn(
      `Ignoring insecure VITE_API_BASE_URL "${configuredBaseUrl}" because the app is running over HTTPS. Falling back to same-origin /api.`
    );
    return "/api";
  }

  return configuredBaseUrl;
}

const API_BASE_URL = resolveApiBaseUrl();

class ApiClient {
  token = "";
  unauthorizedHandler = null;

  setToken(token) {
    this.token = token;
  }

  onUnauthorized(handler) {
    this.unauthorizedHandler = handler;
  }

  async request(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...options.headers,
      },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        this.token = "";
        this.unauthorizedHandler?.();
      }
      throw new Error(data.message || "Request failed");
    }
    return data;
  }

  get(path) {
    return this.request(path);
  }

  post(path, body) {
    return this.request(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  put(path, body) {
    return this.request(path, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }
}

export const apiClient = new ApiClient();
