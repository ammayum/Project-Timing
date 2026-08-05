import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { apiClient } from "../services/api.js";

function StatusPill({ status }) {
  const styles = {
    used_in_timesheets: "bg-bt-purple/10 text-bt-purple-dark",
    in_stock_not_used: "bg-bt-purple-lightest/50 text-bt-purple-dark",
    used_not_in_stock_report: "bg-bt-purple-lightest/50 text-bt-purple-deep",
  };

  const labels = {
    used_in_timesheets: "Used",
    in_stock_not_used: "Not Used",
    used_not_in_stock_report: "Used Missing In Stock",
  };

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${styles[status] || "bg-white/10 text-white"}`}>
      {labels[status] || status}
    </span>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
    </div>
  );
}

export function ProjectKitsPage() {
  const [expandedProjects, setExpandedProjects] = useState({});
  const [stockSearch, setStockSearch] = useState("");
  const [stockPage, setStockPage] = useState(1);
  const stockPageSize = 10;

  const projectsQuery = useQuery({
    queryKey: ["projects-with-kits"],
    queryFn: () => apiClient.get("/admin/projects-with-kits"),
  });

  const stockReportQuery = useQuery({
    queryKey: ["stock-report-vs-kits-used"],
    queryFn: () => apiClient.get("/kits/stock-report"),
  });

  const toggleProject = (projectId) => {
    setExpandedProjects((prev) => ({
      ...prev,
      [projectId]: !prev[projectId],
    }));
  };

  if (projectsQuery.isLoading || stockReportQuery.isLoading) {
    return <div className="glass-panel rounded-[2rem] border border-white/10 p-6">Loading project kits...</div>;
  }

  const projects = projectsQuery.data?.projects || [];
  const stockSummary = stockReportQuery.data?.summary || {};
  const stockRows = stockReportQuery.data?.stock || [];
  const usedWithoutStock = stockReportQuery.data?.usedWithoutStock || [];
  const normalizedStockSearch = stockSearch.trim().toLowerCase();
  const stockReportRows = [
    ...stockRows,
    ...usedWithoutStock.map((row) => ({
      ...row,
      product_name: "",
    })),
  ];
  const filteredStockRows = stockReportRows.filter((row) => {
    if (!normalizedStockSearch) {
      return true;
    }

    return [row.serial_number, row.part_code].some((value) =>
      String(value || "")
        .toLowerCase()
        .includes(normalizedStockSearch),
    );
  });
  const totalStockPages = Math.max(1, Math.ceil(filteredStockRows.length / stockPageSize));
  const currentStockPage = Math.min(stockPage, totalStockPages);
  const paginatedStockRows = filteredStockRows.slice(
    (currentStockPage - 1) * stockPageSize,
    currentStockPage * stockPageSize,
  );

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-[2rem] border border-white/10 p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Project Relations</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Kits By Project And Stock Check</h2>
        <p className="mt-2 text-sm text-slate-300">
          Review project-linked kits, compare stock report rows against kits used in timesheets, and spot missing stock references.
        </p>
      </section>

      <section className="glass-panel rounded-[2rem] border border-white/10 p-6 shadow-panel">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Stock Reconciliation</p>
            <h3 className="mt-2 text-xl font-semibold text-white">Stock Report Vs Kits Used</h3>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Stock Rows" value={stockSummary.stock_rows ?? 0} />
          <MetricCard label="Used In Timesheets" value={stockSummary.used_in_timesheets ?? 0} />
          <MetricCard label="In Stock Not Used" value={stockSummary.in_stock_not_used ?? 0} />
          <MetricCard label="Used Missing In Stock" value={stockSummary.used_not_in_stock_report ?? 0} />
        </div>

        <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <input
            type="text"
            value={stockSearch}
            onChange={(event) => {
              setStockSearch(event.target.value);
              setStockPage(1);
            }}
            placeholder="Search by serial or part code"
            className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white"
          />
          <p className="text-sm text-slate-400">
            Showing {paginatedStockRows.length} of {filteredStockRows.length} rows
          </p>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.2em] text-slate-400">
              <tr>
                <th className="px-3 py-3">Serial</th>
                <th className="px-3 py-3">Part Code</th>
                <th className="px-3 py-3">Product</th>
              </tr>
            </thead>
            <tbody>
              {paginatedStockRows.length ? (
                paginatedStockRows.map((row, index) => (
                <tr
                  key={row.id ?? `${row.serial_number || ""}-${row.part_code || ""}-${row.status || ""}-${index}`}
                  className="border-t border-white/10 text-slate-300"
                >
                  <td className="px-3 py-3 text-white">{row.serial_number || "-"}</td>
                  <td className="px-3 py-3">{row.part_code || "-"}</td>
                  <td className="px-3 py-3">
                    <div className="text-white">{row.product_name || "-"}</div>
                    <div className="mt-1">
                      <StatusPill status={row.status} />
                    </div>
                  </td>
                </tr>
              ))
              ) : (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-slate-400">
                    No stock rows match the current search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setStockPage((current) => Math.max(1, current - 1))}
            disabled={currentStockPage === 1}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${
              currentStockPage === 1 ? "bg-white/10 text-slate-500" : "bg-white/10 text-white"
            }`}
          >
            Previous
          </button>
          <p className="text-sm text-slate-400">
            Page {currentStockPage} of {totalStockPages}
          </p>
          <button
            type="button"
            onClick={() => setStockPage((current) => Math.min(totalStockPages, current + 1))}
            disabled={currentStockPage === totalStockPages}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${
              currentStockPage === totalStockPages ? "bg-white/10 text-slate-500" : "bg-white/10 text-white"
            }`}
          >
            Next
          </button>
        </div>
      </section>

      <section className="glass-panel rounded-[2rem] border border-white/10 p-6 shadow-panel">
        <div className="space-y-4">
          {projects.map((project) => {
            const kits = (project.kits || []).filter(Boolean);
            const projectId = project.id;
            const expanded = expandedProjects[projectId];

            return (
              <div key={projectId} className="overflow-hidden rounded-2xl border border-white/10">
                <button
                  type="button"
                  onClick={() => toggleProject(projectId)}
                  className="flex w-full items-center justify-between bg-white/5 px-5 py-4 transition hover:bg-white/10"
                >
                  <div className="flex items-center gap-3">
                    {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    <div className="text-left">
                      <p className="font-semibold text-white">{project.ja_code}</p>
                      <p className="text-sm text-slate-300">{project.project_name}</p>
                    </div>
                  </div>

                  <span className="rounded-full bg-aqua/10 px-3 py-1 text-xs text-aqua">{kits.length} Kits</span>
                </button>

                {expanded && (
                  <div className="overflow-x-auto">
                    {kits.length ? (
                      <table className="min-w-full text-left text-sm">
                        <thead className="text-xs uppercase tracking-[0.2em] text-slate-400">
                          <tr>
                            <th className="px-4 py-3">Serial</th>
                            <th className="px-4 py-3">Part Code</th>
                            <th className="px-4 py-3">Type</th>
                            <th className="px-4 py-3">Brand</th>
                            <th className="px-4 py-3">Model</th>
                          </tr>
                        </thead>
                        <tbody>
                          {kits.map((kit) => (
                            <tr key={kit.id} className="border-t border-white/10 text-slate-300">
                              <td className="px-4 py-3 text-white">{kit.serial_number || "-"}</td>
                              <td className="px-4 py-3">{kit.part_code || "-"}</td>
                              <td className="px-4 py-3">{kit.device_type || "-"}</td>
                              <td className="px-4 py-3">{kit.brand || "-"}</td>
                              <td className="px-4 py-3">{kit.model || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="px-5 py-4 text-sm text-slate-400">No kits assigned yet.</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
