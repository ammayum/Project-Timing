import { useState } from "react";
import { X } from "lucide-react";
import { apiClient } from "../services/api.js";
import { StatusBanner } from "./StatusBanner.jsx";

export function CsvUploadModal({ isOpen, onClose, onPreviewReady }) {
  const [csvContent, setCsvContent] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isOpen) {
    return null;
  }

  const handleValidate = async () => {
    setLoading(true);
    setError("");
    try {
      const preview = await apiClient.post("/time-entries/upload", { csvContent });
      onPreviewReady(preview);
      onClose();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/80 p-4">
      <div className="glass-panel w-full max-w-3xl rounded-[1.75rem] border border-white/10 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-xl font-semibold text-white">Upload CSV</h3>
            <p className="mt-2 text-sm text-slate-300">
              Paste CSV content for validation and preview before save.
            </p>
            <p className="mt-2 text-xs text-slate-400">
              Required columns: <span className="text-white">date, activity, project, from_time, to_time, overtime, kits</span>
            </p>
            <p className="mt-1 text-xs text-slate-400">
              The <span className="text-white">kits</span> column must use space-separated values only, for example:
              <span className="ml-1 text-white">SR123 PC456 SN789</span>
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full bg-white/5 p-2">
            <X size={18} />
          </button>
        </div>
        <textarea
          value={csvContent}
          onChange={(event) => setCsvContent(event.target.value)}
          placeholder={"date,activity,project,from_time,to_time,overtime,kits\n2026-07-20,Project,JA001,08:00,12:00,false,SR123 PC456"}
          className="mt-5 min-h-72 w-full rounded-3xl border border-white/10 bg-slate-950/60 p-4 text-sm text-white outline-none"
        />
        <div className="mt-4 space-y-4">
          <StatusBanner message={error} tone="error" />
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-2xl bg-white/5 px-4 py-2 text-sm">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleValidate}
              disabled={!csvContent.trim() || loading}
              className="rounded-2xl bg-flare px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? "Validating..." : "Validate CSV"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
