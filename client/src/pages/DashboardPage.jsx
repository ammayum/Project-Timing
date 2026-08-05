import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, FolderKanban, ShieldCheck, Boxes, ArrowRight } from "lucide-react";
import { apiClient } from "../services/api.js";

function formatToday() {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

export function DashboardPage({
  auth,
  canAccessAdmin,
  canAccessProjectKits,
  canAccessPerformance,
  onOpenTimesheet,
  onOpenAdmin,
  onOpenProjectKits,
  onOpenPerformance,
}) {
  const metaQuery = useQuery({
    queryKey: ["dashboard-meta"],
    queryFn: () => apiClient.get("/time-entries/meta"),
  });

  const adminQuery = useQuery({
    queryKey: ["dashboard-admin"],
    queryFn: () => apiClient.get("/admin"),
    enabled: canAccessAdmin,
    
  });

  const stats = useMemo(
    () => [
      {
        label: "Active Projects",
        value: metaQuery.data?.projects?.length ?? 0,
        icon: FolderKanban,
        tint: "text-aqua",
      },
      {
        label: "Activity Types",
        value: metaQuery.data?.activities?.length ?? 0,
        icon: CalendarDays,
        tint: "text-flare",
      },
      {
        label: "Kits Available",
        value: adminQuery.data?.kits?.length ?? 0,
        icon: Boxes,
        tint: "text-bt-purple-mid",
      },
      {
        label: "Access Role",
        value: auth.employee.role || (canAccessAdmin ? "admin" : "employee"),
        icon: ShieldCheck,
        tint: "text-bt-purple-dark",
      },
    ],
    [adminQuery.data?.kits?.length, auth.employee.role, canAccessAdmin, metaQuery.data?.activities?.length, metaQuery.data?.projects?.length],
  );

  return (
    <div className="space-y-6">
      <section className="glass-panel overflow-hidden rounded-[2rem] border border-white/10 shadow-panel">
        <div className="grid gap-8 p-6 lg:grid-cols-[1.25fr_0.75fr] lg:p-8">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-aqua">Workspace Ready</p>
            <h2 className="mt-3 max-w-2xl text-4xl font-semibold leading-tight text-white">
              Welcome back, {auth.employee.name.split(" ")[0]}. Your daily billing workspace is ready.
            </h2>
            <p className="mt-4 max-w-2xl text-base text-slate-300">
              Start a timesheet, review project-linked kits, monitor employee performance, or head into admin controls.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onOpenTimesheet}
                className="inline-flex items-center gap-2 rounded-2xl bg-flare px-5 py-3 text-sm font-semibold text-white"
              >
                Open Timesheet
                <ArrowRight size={16} />
              </button>
              {canAccessProjectKits ? (
                <button
                  type="button"
                  onClick={onOpenProjectKits}
                  className="rounded-2xl bg-bt-purple-light px-5 py-3 text-sm font-semibold text-white"
                >
                  View Project Kits
                </button>
              ) : null}
              {canAccessPerformance ? (
                <button
                  type="button"
                  onClick={onOpenPerformance}
                  className="rounded-2xl bg-bt-purple-mid px-5 py-3 text-sm font-semibold text-white"
                >
                  View Performance
                </button>
              ) : null}
              {canAccessAdmin ? (
                <button
                  type="button"
                  onClick={onOpenAdmin}
                  className="rounded-2xl bg-white/10 px-5 py-3 text-sm font-semibold text-white"
                >
                  Open Admin
                </button>
              ) : null}
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Today</p>
            <p className="mt-3 text-2xl font-semibold text-white">{formatToday()}</p>
            <div className="mt-6 space-y-3 text-sm text-slate-300">
              <div className="rounded-2xl border border-aqua/20 bg-aqua/10 p-3">
                Local access active for <span className="font-semibold text-white">{auth.employee.email}</span>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                EIN: <span className="font-semibold text-white">{auth.employee.ein || "Not set"}</span>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                Role: <span className="font-semibold text-white">{auth.employee.role || "employee"}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="glass-panel rounded-[1.75rem] border border-white/10 p-5 shadow-panel">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-300">{stat.label}</p>
                <Icon size={18} className={stat.tint} />
              </div>
              <p className="mt-5 text-3xl font-semibold text-white">{stat.value}</p>
            </div>
          );
        })}
      </section>
    </div>
  );
}
