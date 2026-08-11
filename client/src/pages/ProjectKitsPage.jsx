import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { apiClient } from "../services/api.js";
import { StatusBanner } from "../components/StatusBanner.jsx";

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

function MatchPill({ status }) {
  const labels = {
    matched: "Update available",
    up_to_date: "Up to date",
    unmatched: "No kit match",
    conflict: "Match conflict",
    ignored: "No identifier",
  };

  const styles = {
    matched: "bg-bt-purple/10 text-bt-purple-dark",
    up_to_date: "bg-bt-purple-lightest/50 text-bt-purple-dark",
    unmatched: "bg-white/10 text-slate-500",
    conflict: "bg-bt-purple-lightest text-bt-purple-deep",
    ignored: "bg-white/10 text-slate-500",
  };

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${styles[status] || styles.unmatched}`}>
      {labels[status] || "Not updateable"}
    </span>
  );
}

export function ProjectKitsPage({ stockOnly = false }) {
  const queryClient = useQueryClient();
  const [expandedProjects, setExpandedProjects] = useState({});
  const [stockSearch, setStockSearch] = useState("");
  const [stockPage, setStockPage] = useState(1);
  const [stockUpdateMessage, setStockUpdateMessage] = useState({ message: "", tone: "info" });
  const [previewRow, setPreviewRow] = useState(null);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [updatingStock, setUpdatingStock] = useState(false);
  const stockPageSize = 10;

  const projectsQuery = useQuery({
    queryKey: ["projects-with-kits"],
    queryFn: () => apiClient.get("/admin/projects-with-kits"),
    enabled: !stockOnly,
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

  const refreshKitQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["stock-report-vs-kits-used"] }),
      queryClient.invalidateQueries({ queryKey: ["projects-with-kits"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-data"] }),
    ]);
  };

  const updateStockMatches = async (scope, rows = []) => {
    try {
      setUpdatingStock(true);
      const result = await apiClient.post("/kits/stock-report/update", { scope, rows });
      setStockUpdateMessage({
        message: `${result.updated_count} kit${result.updated_count === 1 ? "" : "s"} updated. ${result.unchanged_count} unchanged, ${result.skipped_count} skipped.`,
        tone: result.updated_count ? "success" : "info",
      });
      setPreviewRow(null);
      setBulkConfirmOpen(false);
      await refreshKitQueries();
    } catch (error) {
      setStockUpdateMessage({ message: error.message || "Unable to update kits from stock report.", tone: "error" });
    } finally {
      setUpdatingStock(false);
    }
  };

  if ((!stockOnly && projectsQuery.isLoading) || stockReportQuery.isLoading) {
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
  const validStockMatches = stockRows.filter((row) => row.updateable);
  const proposedFieldCount = validStockMatches.reduce(
    (total, row) => total + Object.keys(row.proposed_changes || {}).length,
    0,
  );
  const proposedFieldNames = [...new Set(validStockMatches.flatMap((row) => Object.keys(row.proposed_changes || {})))];

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-[2rem] border border-white/10 p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-400">{stockOnly ? "Kit Metadata Updates" : "Project Relations"}</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">{stockOnly ? "Stock Report Kit Updates" : "Kits By Project And Stock Check"}</h2>
        <p className="mt-2 text-sm text-slate-300">
          {stockOnly
            ? "Review matching stock records and safely update blank or auto-generated kit metadata."
            : "Review project-linked kits, compare stock report rows against kits used in timesheets, and spot missing stock references."}
        </p>
      </section>

      <section className="glass-panel rounded-[2rem] border border-white/10 p-6 shadow-panel">
        <StatusBanner message={stockUpdateMessage.message} tone={stockUpdateMessage.tone} />
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Stock Reconciliation</p>
            <h3 className="mt-2 text-xl font-semibold text-white">Stock Report Vs Kits Used</h3>
          </div>
          <button
            type="button"
            onClick={() => setBulkConfirmOpen(true)}
            disabled={!validStockMatches.length || updatingStock}
            className="rounded-xl bg-aqua px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Update All Valid Matches
          </button>
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
                <th className="px-3 py-3">Match</th>
                <th className="px-3 py-3">Action</th>
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
                  <td className="px-3 py-3">
                    <MatchPill status={row.match_status || "unmatched"} />
                    {row.matched_by && <div className="mt-1 text-xs text-slate-400">By {row.matched_by.replace("_", " ")}</div>}
                    {Object.keys(row.proposed_changes || {}).length > 0 && (
                      <div className="mt-1 text-xs text-slate-400">
                        {Object.keys(row.proposed_changes).length} field{Object.keys(row.proposed_changes).length === 1 ? "" : "s"} ready
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => setPreviewRow(row)}
                      disabled={!row.updateable || updatingStock}
                      className="rounded-lg bg-aqua/15 px-3 py-2 text-xs font-semibold text-aqua disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Preview
                    </button>
                  </td>
                </tr>
              ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-slate-400">
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

      {!stockOnly && (
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
      )}

      {previewRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <section className="glass-panel w-full max-w-xl rounded-[2rem] border border-white/10 p-6 shadow-panel">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Stock Match Preview</p>
                <h3 className="mt-2 text-xl font-semibold text-white">
                  {previewRow.serial_number || previewRow.part_code || "Kit"}
                </h3>
                <p className="mt-1 text-sm text-slate-400">Matched by {previewRow.matched_by?.replace("_", " ")}</p>
              </div>
              <button type="button" onClick={() => setPreviewRow(null)} className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white">
                Close
              </button>
            </div>

            <div className="mt-6 space-y-3">
              {Object.entries(previewRow.proposed_changes || {}).map(([field, change]) => (
                <div key={field} className="grid gap-2 rounded-xl border border-white/10 bg-white/5 p-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <div>
                    <p className="text-xs uppercase tracking-[0.15em] text-slate-400">{field.replace("_", " ")}</p>
                    <p className="mt-1 text-sm text-slate-400">{change.from || "(blank)"}</p>
                  </div>
                  <span className="text-sm text-bt-purple">to</span>
                  <p className="text-sm font-semibold text-white">{change.to}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setPreviewRow(null)} className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => updateStockMatches("selected", [previewRow])}
                disabled={updatingStock}
                className="rounded-xl bg-aqua px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {updatingStock ? "Updating..." : "Update Kit"}
              </button>
            </div>
          </section>
        </div>
      )}

      {bulkConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <section className="glass-panel w-full max-w-lg rounded-[2rem] border border-white/10 p-6 shadow-panel">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Confirm Bulk Update</p>
            <h3 className="mt-2 text-xl font-semibold text-white">Update valid stock matches?</h3>
            <p className="mt-3 text-sm text-slate-300">
              This will update {validStockMatches.length} kit{validStockMatches.length === 1 ? "" : "s"} and {proposedFieldCount} safe metadata field{proposedFieldCount === 1 ? "" : "s"}. Existing manual values will not be overwritten.
            </p>
            <p className="mt-2 text-sm text-slate-400">
              Fields: {proposedFieldNames.join(", ") || "none"}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setBulkConfirmOpen(false)} className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => updateStockMatches("all-valid")}
                disabled={updatingStock}
                className="rounded-xl bg-aqua px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {updatingStock ? "Updating..." : "Confirm Update All"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
