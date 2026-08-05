import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Boxes, ChartColumnIncreasing, Clock, Home, ShieldCheck } from "lucide-react";
import { useAuth } from "./hooks/useAuth.js";
import React from 'react';
//import BTlogoo from "client/public/BT_Logo_Indigo_RGB1.png";


const TimeEntryPage = lazy(() =>
  import("./pages/TimeEntryPage.jsx").then((module) => ({ default: module.TimeEntryPage }))
);
const AdminPage = lazy(() =>
  import("./pages/AdminPage.jsx").then((module) => ({ default: module.AdminPage }))
);
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage.jsx").then((module) => ({ default: module.DashboardPage }))
);
const ProjectKitsPage = lazy(() =>
  import("./pages/ProjectKitsPage.jsx").then((module) => ({ default: module.ProjectKitsPage }))
);
const PerformancePage = lazy(() =>
  import("./pages/PerformancePage.jsx").then((module) => ({ default: module.PerformancePage }))
);

export function App() {
  const [activeTab, setActiveTab] = useState("time");
  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordChangeError, setPasswordChangeError] = useState("");
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false);

  const { auth, loading, loginToApi, changePassword, logout } = useAuth();

  const canAccessAdmin = useMemo(() => Boolean(auth?.employee?.is_admin), [auth]);
  const canAccessProjectKits = useMemo(
    () => Boolean(auth?.employee?.is_admin || auth?.employee?.role === "manager"),
    [auth]
  );
  const canAccessPerformance = canAccessProjectKits;
  const defaultAuthedTab = canAccessAdmin ? "admin" : "time";

  useEffect(() => {
    if (auth?.employee?.mustChangePassword) {
      return;
    }

    if (auth) {
      setActiveTab(defaultAuthedTab);
    }
  }, [auth, defaultAuthedTab]);

  const handleCustomLogin = async (e) => {
    e.preventDefault();
    setLoginError("");

    if (!identity.trim() || !password.trim()) {
      setLoginError("Please enter your credentials.");
      return;
    }

    try {
      await loginToApi({
        username: identity.trim(),
        password,
      });
    } catch (error) {
      setLoginError(error.message || "Invalid username/email or password.");
    }
  };

  const handleForcedPasswordChange = async (e) => {
    e.preventDefault();
    setPasswordChangeError("");

    if (!currentPassword.trim() || !newPassword.trim() || !confirmPassword.trim()) {
      setPasswordChangeError("Please complete all password fields.");
      return;
    }

    if (newPassword.length < 8) {
      setPasswordChangeError("New password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordChangeError("New password and confirmation do not match.");
      return;
    }

    if (currentPassword === newPassword) {
      setPasswordChangeError("Please choose a password different from the temporary password.");
      return;
    }

    try {
      setPasswordChangeLoading(true);
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      setPasswordChangeError(error.message || "Unable to change password.");
    } finally {
      setPasswordChangeLoading(false);
    }
  };

  if (!auth) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <section className="glass-panel w-full max-w-4xl rounded-[2rem] border border-white/10 p-10 shadow-panel">
          <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-5">
              <p className="text-sm uppercase tracking-[0.35em] text-aqua">Project Billing System</p>
              
              <p className="max-w-2xl text-base text-slate-300">
                Sign in with Login .
              </p>
              
              <img
                src="/BT_Logo_Indigo_RGB1.png"
                alt="BT logo"
                width="2000"
                height="20000"
                className="mt-4 block h-auto w-[200px] object-contain"
              />
            </div>

            <div className="flex flex-col justify-center rounded-[1.5rem] border border-white/10 bg-white/5 p-6">
              <h2 className="text-2xl font-semibold text-white">Sign In</h2>
              <p className="mt-1 text-sm text-slate-300">Enter your username and password.</p>

              <form onSubmit={handleCustomLogin} className="mt-6 space-y-4">
                <input
                  type="text"
                  value={identity}
                  onChange={(e) => setIdentity(e.target.value)}
                  placeholder="Username or email"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-aqua"
                />

                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-aqua"
                />

                {loginError && (
                  <div className="rounded-lg border border-bt-purple/20 bg-bt-purple-lightest/40 p-3 text-sm text-bt-purple-dark">
                    {loginError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-aqua py-3 font-semibold text-white"
                >
                  {loading ? "Signing In..." : "Login"}
                </button>
              </form>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (auth.employee?.mustChangePassword) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <section className="glass-panel-header w-full max-w-2xl rounded-[2rem] border border-white/10 p-10 shadow-panel">
          <div className="space-y-5">
            <p className="text-sm uppercase tracking-[0.35em] text-aqua">Password Update Required</p>
            <h1 className="text-4xl font-semibold leading-tight text-white">
              Change your temporary password to continue.
            </h1>
            <p className="max-w-xl text-base text-slate-300">
              This account is marked for first-login password change by an administrator.
            </p>
          </div>

          <form onSubmit={handleForcedPasswordChange} className="mt-8 space-y-4">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Temporary password"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-aqua"
            />

            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-aqua"
            />

            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-aqua"
            />

            {passwordChangeError && (
              <div className="rounded-lg border border-bt-purple/20 bg-bt-purple-lightest/40 p-3 text-sm text-bt-purple-dark">
                {passwordChangeError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={passwordChangeLoading}
                className="rounded-xl bg-aqua px-5 py-3 font-semibold text-white"
              >
                {passwordChangeLoading ? "Updating..." : "Change Password"}
              </button>

              <button
                type="button"
                onClick={logout}
                className="rounded-xl bg-white/5 px-5 py-3 text-sm text-slate-100 hover:bg-white/10 transition"
              >
                Sign out
              </button>
            </div>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 text-black md:p-8">
      <section className="mx-auto max-w-7xl space-y-6">
        <header className="glass-panel-header flex flex-col gap-4 rounded-[2rem] border border-white/10 p-6 shadow-panel md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-aqua">Project Billing System</p>
            <h1 className="mt-2 text-3xl font-semibold text-white">{auth.employee.name}</h1>
            <p className="mt-2 text-sm text-slate-300">
              {auth.employee.email} · EIN {auth.employee.ein || "Not set"}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setActiveTab("dashboard")}
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium ${
                activeTab === "dashboard" ? "bg-white text-ink" : "bg-white/5 text-slate-200"
              }`}
            >
              <Home size={16} />
              Home
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("time")}
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium ${
                activeTab === "time" ? "bg-aqua text-ink" : "bg-white/5 text-slate-200"
              }`}
            >
              <Clock size={16} />
              Timesheet
            </button>

            {canAccessProjectKits && (
              <button
                type="button"
                onClick={() => setActiveTab("project-kits")}
                className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium ${
                  activeTab === "project-kits" ? "bg-bt-purple-light text-white" : "bg-white/5 text-slate-200"
                }`}
              >
                <Boxes size={16} />
                Project Kits
              </button>
            )}

            {canAccessPerformance && (
              <button
                type="button"
                onClick={() => setActiveTab("performance")}
                className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium ${
                  activeTab === "performance" ? "bg-bt-purple-mid text-white" : "bg-white/5 text-slate-200"
                }`}
              >
                <ChartColumnIncreasing size={16} />
                Performance
              </button>
            )}

            {canAccessAdmin && (
              <button
                type="button"
                onClick={() => setActiveTab("admin")}
                className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium ${
                  activeTab === "admin" ? "bg-flare text-ink" : "bg-white/5 text-slate-200"
                }`}
              >
                <ShieldCheck size={16} />
                Admin
              </button>
            )}

            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-2 rounded-2xl bg-white/5 px-4 py-2 text-sm text-slate-100 hover:bg-white/10 transition"
            >
              Sign out
            </button>
          </div>
        </header>

        <Suspense
          fallback={
            <section className="glass-panel rounded-[2rem] border border-white/10 p-8 text-sm text-slate-300 shadow-panel">
              Loading workspace...
            </section>
          }
        >
          {activeTab === "dashboard" && (
            <DashboardPage
              auth={auth}
              canAccessAdmin={canAccessAdmin}
              canAccessProjectKits={canAccessProjectKits}
              canAccessPerformance={canAccessPerformance}
              onOpenTimesheet={() => setActiveTab("time")}
              onOpenAdmin={() => setActiveTab("admin")}
              onOpenProjectKits={() => setActiveTab("project-kits")}
              onOpenPerformance={() => setActiveTab("performance")}
            />
          )}

          {activeTab === "time" && <TimeEntryPage auth={auth} />}
          {activeTab === "project-kits" && <ProjectKitsPage />}
          {activeTab === "performance" && <PerformancePage />}
          {activeTab === "admin" && <AdminPage auth={auth} />}
        </Suspense>
      </section>
    </main>
  );
}
