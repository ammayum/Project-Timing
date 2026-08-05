import { useEffect, useRef, useState } from "react";
import { apiClient } from "../services/api.js";

const AUTH_STORAGE_KEY = "pbs_auth";
const LAST_ACTIVITY_STORAGE_KEY = "pbs_last_activity_at";
const SESSION_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

function clearStoredAuth() {
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
  sessionStorage.removeItem(LAST_ACTIVITY_STORAGE_KEY);
}

function isSessionExpired(lastActivityAt) {
  if (!lastActivityAt) {
    return false;
  }

  const parsed = Number(lastActivityAt);
  return Number.isFinite(parsed) && Date.now() - parsed > SESSION_IDLE_TIMEOUT_MS;
}

function loadInitialAuth() {
  try {
    const cached = sessionStorage.getItem(AUTH_STORAGE_KEY);
    const lastActivityAt = sessionStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);

    if (!cached || isSessionExpired(lastActivityAt)) {
      clearStoredAuth();
      apiClient.setToken("");
      return null;
    }

    const parsed = JSON.parse(cached);

    if (parsed?.token) {
      apiClient.setToken(parsed.token);
      sessionStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(Date.now()));
      return parsed;
    }
  } catch (_error) {
    clearStoredAuth();
  }

  apiClient.setToken("");
  return null;
}

export function useAuth() {
  const [auth, setAuth] = useState(loadInitialAuth);
  const [loading, setLoading] = useState(false);
  const timeoutRef = useRef(null);

  const persistAuth = (nextAuth) => {
    if (!nextAuth?.token) {
      clearStoredAuth();
      apiClient.setToken("");
      return;
    }

    apiClient.setToken(nextAuth.token);
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextAuth));
    sessionStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(Date.now()));
  };

  const logout = async ({ remote = true } = {}) => {
    const currentToken = auth?.token;

    clearStoredAuth();
    apiClient.setToken("");
    setAuth(null);

    if (remote && currentToken) {
      try {
        apiClient.setToken(currentToken);
        await apiClient.post("/auth/logout", {});
      } catch (_error) {
        // Session may already be expired or revoked; local cleanup is the priority.
      } finally {
        apiClient.setToken("");
      }
    }
  };

  useEffect(() => {
    if (!auth?.token) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return undefined;
    }

    const forceLocalLogout = () => {
      clearStoredAuth();
      apiClient.setToken("");
      setAuth(null);
    };

    const forceRemoteLogout = async () => {
      const currentToken = auth.token;

      forceLocalLogout();

      try {
        apiClient.setToken(currentToken);
        await apiClient.post("/auth/logout", {});
      } catch (_error) {
        // Session may already be expired or revoked; local cleanup is the priority.
      } finally {
        apiClient.setToken("");
      }
    };

    const resetTimeout = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        void forceRemoteLogout();
      }, SESSION_IDLE_TIMEOUT_MS);
    };

    const handleActivity = () => {
      sessionStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(Date.now()));
      resetTimeout();
    };

    const events = ["click", "keydown", "mousemove", "scroll", "touchstart"];

    resetTimeout();

    for (const eventName of events) {
      window.addEventListener(eventName, handleActivity, { passive: true });
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const lastActivityAt = sessionStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);

        if (isSessionExpired(lastActivityAt)) {
          forceLocalLogout();
          return;
        }

        handleActivity();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      for (const eventName of events) {
        window.removeEventListener(eventName, handleActivity);
      }

      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [auth?.token]);

  async function loginToApi({ username, password }) {
    setLoading(true);

    try {
      const response = await apiClient.post("/auth/login", {
        identity: username,
        password,
      });

      persistAuth(response);
      setAuth(response);

      return response;
    } finally {
      setLoading(false);
    }
  }

  async function changePassword({ currentPassword, newPassword }) {
    const response = await apiClient.post("/auth/change-password", {
      currentPassword,
      newPassword,
    });

    setAuth((current) => {
      if (!current) {
        return current;
      }

      const nextAuth = {
        ...current,
        employee: response.employee,
      };

      persistAuth(nextAuth);
      return nextAuth;
    });

    return response;
  }

  useEffect(() => {
    apiClient.onUnauthorized(() => {
      clearStoredAuth();
      setAuth(null);
    });

    return () => apiClient.onUnauthorized(null);
  }, []);

  return {
    auth,
    loading,
    loginToApi,
    changePassword,
    logout,
  };
}
