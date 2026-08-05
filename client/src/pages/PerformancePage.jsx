import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download, Gauge, PackageSearch, TimerReset } from "lucide-react";
import { apiClient } from "../services/api.js";

function defaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 29);

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const normalized = String(value).replace(/"/g, "\"\"");
  return /[",\n]/.test(normalized) ? `"${normalized}"` : normalized;
}

function buildPerformanceCsv(data) {
  const headers = [
    "employee_name",
    "employee_email",
    "employee_ein",
    "total_entries",
    "total_kits",
    "quantity",
    "total_hours",
    "active_days",
    "speed_per_hour",
    "entries_per_day",
    "kits_per_day",
    "activity_date",
    "activity_name",
    "project_code",
    "order_num",
    "from_time",
    "to_time",
    "activity_hours",
    "overtime",
    "kits",
  ];

  const rows = [headers.join(",")];

  for (const employee of data?.employees || []) {
    const activities = employee.activities?.length ? employee.activities : [null];

    for (const activity of activities) {
      rows.push(
        [
          employee.employee_name,
          employee.employee_email,
          employee.employee_ein,
          employee.total_entries,
          employee.total_kits,
          employee.quantity,
          employee.total_hours,
          employee.active_days,
          employee.speed_per_hour,
          employee.entries_per_day,
          employee.kits_per_day,
          activity?.date ?? "",
          activity?.activity_name ?? activity?.activity ?? "",
          activity?.project_code ?? activity?.project ?? "",
          activity?.order_num ?? "",
          activity?.from_time ?? "",
          activity?.to_time ?? "",
          activity?.hours ?? "",
          activity?.overtime ? "yes" : "no",
          (activity?.kits || []).join(" "),
        ]
          .map(escapeCsvValue)
          .join(","),
      );
    }
  }

  return rows.join("\n");
}

function downloadPerformanceCsv(data, startDate, endDate) {
  const csv = buildPerformanceCsv(data);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `performance-report-${startDate}-to-${endDate}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function PerformancePage() {
  const defaults = defaultDateRange();
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [expandedEmployees, setExpandedEmployees] = useState({});

  const performanceQuery = useQuery({
    queryKey: ["employee-performance", startDate, endDate],
    queryFn: () =>
      apiClient.get(`/admin/performance?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`),
  });

  const data = performanceQuery.data;

  const toggleEmployee = (email) => {
    setExpandedEmployees((current) => ({
      ...current,
      [email]: !current[email],
    }));
  };

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-[2rem] border border-white/10 p-6 shadow-panel">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Manager Report</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Employee Performance</h2>
            <p className="mt-2 text-sm text-slate-300">
              Compare entries, kit usage, and speed for each employee over a selected date range.
            </p>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.2em] text-slate-400">Start Date</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm"
                />
              </label>

              <label className="space-y-2">
                <span className="text-xs uppercase tracking-[0.2em] text-slate-400">End Date</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm"
                />
              </label>
            </div>

            <button
              type="button"
              onClick={() => downloadPerformanceCsv(data, startDate, endDate)}
              disabled={!data?.employees?.length}
              className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold ${
                data?.employees?.length
                  ? "bg-bt-purple text-white"
                  : "bg-white/10 text-slate-500"
              }`}
            >
              <Download size={16} />
              Export CSV
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        <MetricCard label="Employees" value={data?.summary?.employees ?? 0} icon={PackageSearch} />
        <MetricCard label="Total Quantity" value={data?.summary?.total_quantity ?? 0} icon={Gauge} />
        <MetricCard label="Total Hours" value={data?.summary?.total_hours ?? 0} icon={TimerReset} />
      </section>

      <section className="glass-panel rounded-[2rem] border border-white/10 p-6 shadow-panel">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.2em] text-slate-400">
              <tr>
                <th className="px-3 py-3">Employee</th>
                <th className="px-3 py-3">EIN</th>
                <th className="px-3 py-3">Entries</th>
                <th className="px-3 py-3">Kits</th>
                <th className="px-3 py-3">Hours</th>
                <th className="px-3 py-3">Active Days</th>
                <th className="px-3 py-3">Speed / Hour</th>
                <th className="px-3 py-3">Entries / Day</th>
                <th className="px-3 py-3">Kits / Day</th>
              </tr>
            </thead>
            <tbody>
              {(data?.employees || []).map((employee) => {
                const employeeKey = employee.employee_email || employee.employee_name;
                const expanded = Boolean(expandedEmployees[employeeKey]);

                return (
                  <>
                    <tr key={employeeKey} className="border-t border-white/10 align-top text-slate-300 hover:bg-white/5">
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => toggleEmployee(employeeKey)}
                          className="flex items-center gap-2 text-left"
                        >
                          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          <span className="font-semibold text-white">{employee.employee_name}</span>
                        </button>
                      </td>
                      <td className="px-3 py-3">{employee.employee_ein || "-"}</td>
                      <td className="px-3 py-3">{employee.total_entries}</td>
                      <td className="px-3 py-3">{employee.total_kits}</td>
                      <td className="px-3 py-3">{employee.total_hours}</td>
                      <td className="px-3 py-3">{employee.active_days}</td>
                      <td className="px-3 py-3">{employee.speed_per_hour}</td>
                      <td className="px-3 py-3">{employee.entries_per_day}</td>
                      <td className="px-3 py-3">{employee.kits_per_day}</td>
                    </tr>

                    {expanded && (
                      <tr key={`${employeeKey}-details`} className="border-t border-white/10">
                        <td colSpan={9} className="bg-slate-950/40 px-6 py-4">
                          <h3 className="mb-3 font-semibold text-white">Activity Details</h3>

                          {(employee.activities || []).length === 0 ? (
                            <p className="text-sm text-slate-400">No activity rows in this period.</p>
                          ) : (
                            <table className="min-w-full text-sm">
                              <thead className="text-xs uppercase text-slate-400">
                                <tr>
                                  <th className="px-3 py-2 text-left">Date</th>
                                  <th className="px-3 py-2 text-left">Activity</th>
                                  <th className="px-3 py-2 text-left">Project</th>
                                  <th className="px-3 py-2 text-left">Order</th>
                                  <th className="px-3 py-2 text-left">Time</th>
                                  <th className="px-3 py-2 text-left">Hours</th>
                                  <th className="px-3 py-2 text-left">Kits</th>
                                </tr>
                              </thead>
                              <tbody>
                                {employee.activities.map((activity, index) => (
                                  <tr
                                    key={activity.id || `${employeeKey}-${activity.date}-${index}`}
                                    className="border-t border-white/10 text-slate-300"
                                  >
                                    <td className="px-3 py-2">{activity.date}</td>
                                    <td className="px-3 py-2">{activity.activity || "-"}</td>
                                    <td className="px-3 py-2">{activity.project || "-"}</td>
                                    <td className="px-3 py-2">{activity.order_num || "-"}</td>
                                    <td className="px-3 py-2">
                                      {activity.from_time} - {activity.to_time}
                                    </td>
                                    <td className="px-3 py-2">{activity.hours}</td>
                                    <td className="px-3 py-2">
                                      {(activity.kits || []).length ? (
                                        (activity.kits || []).map((kit) => (
                                          <span
                                            key={kit}
                                            className="mr-2 inline-block rounded-full bg-aqua/10 px-2 py-1 text-xs text-aqua"
                                          >
                                            {kit}
                                          </span>
                                        ))
                                      ) : (
                                        <span className="text-slate-500">-</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MetricCard({ label, value, icon: Icon }) {
  return (
    <div className="glass-panel rounded-[1.75rem] border border-white/10 p-5 shadow-panel">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-300">{label}</p>
        <Icon size={18} className="text-aqua" />
      </div>
      <p className="mt-4 text-3xl font-semibold text-white">{value}</p>
    </div>
  );
}
