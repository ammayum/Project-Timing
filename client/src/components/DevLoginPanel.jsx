import { useState } from "react";
import { UserRound, Lock } from "lucide-react";

export function DevLoginPanel({ loading, onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = (e) => {
    e.preventDefault();

    onLogin({
      username: username.trim(),
      password,
    });
  };

  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-6">
      <h2 className="text-2xl font-semibold text-white">
        Sign In
      </h2>

      <p className="mt-2 text-sm text-slate-300">
        Enter your username and password to continue.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-5">

        <div>
          <label className="mb-2 block text-sm text-slate-300">
            Username
          </label>

          <div className="flex items-center rounded-xl border border-white/10 bg-slate-950/40 px-3">
            <UserRound className="mr-3 text-slate-400" size={18} />

            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              className="w-full bg-transparent py-3 text-white outline-none placeholder:text-slate-500"
              required
            />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-300">
            Password
          </label>

          <div className="flex items-center rounded-xl border border-white/10 bg-slate-950/40 px-3">
            <Lock className="mr-3 text-slate-400" size={18} />

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full bg-transparent py-3 text-white outline-none placeholder:text-slate-500"
              required
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-aqua py-3 font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
