import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Upload, Send, RefreshCcw } from "lucide-react";
import { apiClient } from "../services/api.js";
import { calculateHours } from "../lib/time.js";
import { createInitialRow, TimeEntryGrid } from "../components/TimeEntryGrid.jsx";
import { CsvUploadModal } from "../components/CsvUploadModal.jsx";
import { StatusBanner } from "../components/StatusBanner.jsx";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function TimeEntryPage({ auth }) {
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState([createInitialRow(today())]);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [status, setStatus] = useState({ message: "", tone: "info" });

  const adminQuery = useQuery({
    queryKey: ["time-entry-meta"],
    queryFn: () => apiClient.get("/time-entries/meta"),
  });

  const workingHoursPerDay = Number(auth?.employee?.working_hours_per_day ?? 7.5);

  const totalHours = useMemo(
    () => rows.reduce((sum, row) => sum + calculateHours(row.from_time, row.to_time), 0),
    [rows],
  );
  const overtimeExceeded = totalHours > workingHoursPerDay && rows.every((row) => !row.overtime);
  const inlineError = overtimeExceeded
    ? `Enable overtime when daily hours exceed ${workingHoursPerDay}.`
    : "";

  const handleSubmit = async () => {
    try {
      const payload = {
        sync: true,
        entries: rows.map((row) => ({ ...row, date })),
      };
      const response = await apiClient.post("/time-entries", payload);
      setStatus({
        message: response.sync.synced
          ? "Entries saved and synced to SharePoint."
          : `Entries saved.    Behind Brilinat Things`,
        tone: "success",
      });
    } catch (error) {
      setStatus({ message: error.message, tone: "error" });
    }
  };

  const handleCsvPreview = (preview) => {
    setRows(
      preview.preview.map((entry) => ({
        date: entry.entry_date,
        activity: entry.activity_name,
        project: entry.project_code ?? "",
        from_time: entry.from_time,
        to_time: entry.to_time,
        overtime: entry.overtime,
        kits: entry.kit_identifiers.join(" "),
      })),
    );
    setStatus({ message: `CSV validated successfully. Total hours: ${preview.totalHours}`, tone: "success" });
  };

  const handleResolveKits = async (kits) => {
    const identifiers = kits
      .split(/[|,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!identifiers.length) {
      return;
    }

    try {
      await apiClient.post("/kits/resolve", { identifiers });
      setStatus({ message: "Kits resolved successfully.", tone: "info" });
    } catch (error) {
      setStatus({ message: error.message, tone: "error" });
    }
  };

  const handleLoadExisting = async () => {
    try {
      const response = await apiClient.get(`/time-entries?date=${date}`);
      if (!response.entries.length) {
        setStatus({ message: "No saved entries for this date yet.", tone: "info" });
        return;
      }
      setRows(
        response.entries.map((entry) => ({
          date: entry.entry_date,
          activity: entry.activity_name || entry.activity_type,
          project: entry.ja_code || "",
          from_time: entry.from_time.slice(0, 5),
          to_time: entry.to_time.slice(0, 5),
          overtime: entry.overtime,
          kits: (entry.kits || []).join(" "),
        })),
      );
      setStatus({ message: "Loaded existing entries for the selected date.", tone: "info" });
    } catch (error) {
      setStatus({ message: error.message, tone: "error" });
    }
  };

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-[2rem] border border-white/10 p-6 shadow-panel">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Daily Entry</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Time Entry Workspace</h2>
            <p className="mt-2 text-sm text-slate-300">
              Add rows, validate kit references, and submit a clean daily sheet without overlap.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Rows</p>
              <p className="mt-1 text-xl font-semibold text-white">{rows.length}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Hours</p>
              <p className="mt-1 text-xl font-semibold text-white">{totalHours.toFixed(2)}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Projects</p>
              <p className="mt-1 text-xl font-semibold text-white">{adminQuery.data?.projects?.length || 0}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="glass-panel rounded-[2rem] border border-white/10 p-5 shadow-panel">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.25em] text-slate-400">Entry Date</span>
              <input
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setRows([createInitialRow(event.target.value)]);
                }}
                className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleLoadExisting}
              className="inline-flex items-center gap-2 rounded-2xl bg-white/5 px-4 py-3 text-sm"
            >
              <RefreshCcw size={16} />
              Load Saved
            </button>
            <button
              type="button"
              onClick={() => setShowCsvModal(true)}
              className="inline-flex items-center gap-2 rounded-2xl bg-white/5 px-4 py-3 text-sm"
            >
              <Upload size={16} />
              Upload CSV
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="inline-flex items-center gap-2 rounded-2xl bg-flare px-4 py-3 text-sm font-semibold text-white"
            >
              <Send size={16} />
              Submit
            </button>
          </div>
        </div>
      </section>

      <StatusBanner message={status.message} tone={status.tone} />

      <TimeEntryGrid
        date={date}
        rows={rows}
        setRows={setRows}
        projects={adminQuery.data?.projects || []}
        totalHours={totalHours}
        maxWorkingHours={workingHoursPerDay}
        overtimeExceeded={overtimeExceeded}
        inlineError={inlineError}
        onResolveKits={handleResolveKits}
        auth={auth}
      />

      <CsvUploadModal isOpen={showCsvModal} onClose={() => setShowCsvModal(false)} onPreviewReady={handleCsvPreview} />
    </div>
  );
}
