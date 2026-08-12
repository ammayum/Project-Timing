import { useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { apiClient } from "../services/api.js";
import { StatusBanner } from "../components/StatusBanner.jsx";

const emptyRow = () => ({ name: "", serial_numbers: "" });

function ResultStatus({ status }) {
  const found = status === "found_on_stock";
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
        found ? "bg-bt-purple/10 text-bt-purple-dark" : "bg-white/10 text-slate-500"
      }`}
    >
      {found ? "Found on Stock" : "Not on Stock"}
    </span>
  );
}

function toCsv(rows) {
  const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
  return [
    "name,serial_numbers",
    ...rows.map((row) => `${quote(row.name)},${quote(row.serial_numbers)}`),
  ].join("\n");
}

function quoteCsv(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function LogVsStockPage({ publicMode = false, onBack }) {
  const [rows, setRows] = useState([emptyRow()]);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState({ message: "", tone: "info" });
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [stockSerials, setStockSerials] = useState("");
  const [resultFilter, setResultFilter] = useState("all");

  const updateRow = (index, field, value) => {
    setRows((current) => current.map((row, rowIndex) => (
      rowIndex === index ? { ...row, [field]: value } : row
    )));
  };

  const filteredResults = (result?.results || []).filter((row) => (
    resultFilter === "all" || row.status === resultFilter
  ));

  const copyResults = async () => {
    const copiedCsv = [
      "name,serial_number,status",
      ...filteredResults.map((row) => [
        quoteCsv(row.name),
        quoteCsv(row.serial_number),
        quoteCsv(row.status === "found_on_stock" ? "Found on Stock" : "Not on Stock"),
      ].join(",")),
    ].join("\n");

    try {
      await navigator.clipboard.writeText(copiedCsv);
      setStatus({ message: `${filteredResults.length} result${filteredResults.length === 1 ? "" : "s"} copied.`, tone: "success" });
    } catch (_error) {
      setStatus({ message: "Unable to copy results from this browser.", tone: "error" });
    }
  };

  const compareWithStock = async (event) => {
    event.preventDefault();
    const validRows = rows
      .map((row) => ({ name: row.name.trim(), serial_numbers: row.serial_numbers.trim() }))
      .filter((row) => row.name && row.serial_numbers);

    if (!validRows.length) {
      setStatus({ message: "Add at least one name and serial-number list.", tone: "error" });
      return;
    }

    try {
      setLoading(true);
      if (publicMode && !stockSerials.trim()) {
        setStatus({ message: "A stock serial list is required for public comparison.", tone: "error" });
        return;
      }
      if (publicMode) {
        await submitCsv(toCsv(validRows));
        return;
      }
      const response = await apiClient.post("/kits/log-vs-stock", {
        rows: validRows,
        stock_serials: stockSerials,
      });
      setResult(response);
      setStatus({ message: "Log comparison completed.", tone: "success" });
    } catch (error) {
      setStatus({ message: error.message, tone: "error" });
    } finally {
      setLoading(false);
    }
  };

  const submitCsv = async (csvContent) => {
    try {
      setUploading(true);
      const response = await apiClient.post(publicMode ? "/public/log-vs-stock/upload" : "/kits/log-vs-stock/upload", {
        csvContent,
        stock_serials: stockSerials,
      });
      setResult(response);
      setStatus({ message: `Bulk upload completed: ${response.uploaded_rows} rows checked.`, tone: "success" });
      return response;
    } catch (error) {
      setStatus({ message: error.message, tone: "error" });
    } finally {
      setUploading(false);
    }
  };

  const uploadCsv = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      await submitCsv(await file.text());
    }
  };

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-[2rem] border border-white/10 p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Stock Lookup</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Log_vs_stock</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          {publicMode
            ? "Paste a log CSV and a stock serial list to compare them without signing in."
            : "Enter a name and a space-separated list of serial numbers. Each serial is checked against the stock report."}
        </p>
        {onBack && (
          <button type="button" onClick={onBack} className="mt-4 rounded-xl bg-white/10 px-3 py-2 text-sm text-white">
            Back to sign in
          </button>
        )}
      </section>

      <section className="glass-panel rounded-[2rem] border border-white/10 p-6 shadow-panel">
        <StatusBanner message={status.message} tone={status.tone} />
        <form onSubmit={compareWithStock}>
          {!publicMode && (
          <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.2em] text-slate-400">
                <tr>
                  <th className="px-3 py-3">Name</th>
                  <th className="px-3 py-3">Serial numbers separated by space</th>
                  <th className="px-3 py-3" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`log-row-${index}`} className="border-t border-white/10">
                    <td className="px-3 py-3 align-top">
                      <input
                        value={row.name}
                        onChange={(event) => updateRow(index, "name", event.target.value)}
                        placeholder="Employee or log name"
                        className="w-full min-w-[220px] rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-white"
                      />
                    </td>
                    <td className="px-3 py-3 align-top">
                      <textarea
                        value={row.serial_numbers}
                        onChange={(event) => updateRow(index, "serial_numbers", event.target.value)}
                        placeholder="SN001 SN002 SN003"
                        rows={2}
                        className="w-full min-w-[360px] rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-white"
                      />
                    </td>
                    <td className="px-3 py-3 align-top">
                      <button
                        type="button"
                        onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                        disabled={rows.length === 1}
                        className="rounded-xl bg-white/10 p-2 text-coral disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label="Remove row"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex flex-wrap justify-between gap-3">
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setRows((current) => [...current, emptyRow()])}
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm text-white"
              >
                <Plus size={16} />
                Add row
              </button>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm text-white">
                {uploading ? "Uploading..." : "Bulk upload CSV"}
                <input type="file" accept=".csv,text/csv" onChange={uploadCsv} disabled={uploading} className="sr-only" />
              </label>
            </div>
            <button
              type="submit"
              disabled={loading || uploading}
              className="inline-flex items-center gap-2 rounded-xl bg-bt-purple px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Search size={16} />
              {loading ? "Checking..." : "Check stock"}
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            CSV headers: <span className="text-slate-300">name,serial_numbers</span>. Keep multiple serial numbers space-separated in one cell.
          </p>
          </>
          )}
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
            <label className="block text-xs uppercase tracking-[0.2em] text-slate-400" htmlFor="optional-stock-serials">
              Stock serial list
            </label>
            <textarea
              id="optional-stock-serials"
              value={stockSerials}
              onChange={(event) => setStockSerials(event.target.value)}
              placeholder="STOCK001 STOCK002 STOCK003"
              rows={3}
              className="mt-3 w-full rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 font-mono text-sm text-white"
            />
            <p className="mt-2 text-xs text-slate-400">
              {publicMode
                ? "Required for public comparison. Separate serials with spaces or new lines."
                : "When filled, this list is used instead of the database stock report. Separate serials with spaces or new lines."}
            </p>
            {!publicMode && (
            <label className="mt-3 inline-flex cursor-pointer rounded-xl bg-white/10 px-3 py-2 text-xs text-white">
              Upload stock serial list
              <input
                type="file"
                accept=".txt,.csv,text/plain,text/csv"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) {
                    setStockSerials(await file.text());
                  }
                }}
                className="sr-only"
              />
            </label>
            )}
          </div>
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
            <label className="block text-xs uppercase tracking-[0.2em] text-slate-400" htmlFor="log-stock-csv-paste">
              Paste CSV
            </label>
            <textarea
              id="log-stock-csv-paste"
              value={csvText}
              onChange={(event) => setCsvText(event.target.value)}
              placeholder={'name,serial_numbers\nEmployee A,"SN001 SN002 SN003"'}
              rows={5}
              className="mt-3 w-full rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 font-mono text-sm text-white"
            />
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={async () => {
                  if (csvText.trim()) {
                    await submitCsv(csvText);
                  }
                }}
                disabled={!csvText.trim() || uploading}
                className="rounded-xl bg-bt-purple px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploading ? "Checking..." : "Check pasted CSV"}
              </button>
            </div>
          </div>
        </form>
      </section>

      {result && (
        <section className="glass-panel rounded-[2rem] border border-white/10 p-6 shadow-panel">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Submitted</p>
              <p className="mt-1 text-2xl font-semibold text-white">{result.summary.submitted}</p>
            </div>
            <div className="rounded-xl bg-bt-purple/10 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-bt-purple-dark">Found on Stock</p>
              <p className="mt-1 text-2xl font-semibold text-bt-purple-dark">{result.summary.found_on_stock}</p>
            </div>
            <div className="rounded-xl bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Not on Stock</p>
              <p className="mt-1 text-2xl font-semibold text-slate-500">{result.summary.not_on_stock}</p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {[
                ["all", "All"],
                ["found_on_stock", "Found on Stock"],
                ["not_on_stock", "Not on Stock"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setResultFilter(value)}
                  className={`rounded-xl px-3 py-2 text-sm ${
                    resultFilter === value ? "bg-bt-purple text-white" : "bg-white/10 text-slate-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={copyResults}
              disabled={!filteredResults.length}
              className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Copy filtered results
            </button>
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.2em] text-slate-400">
                <tr>
                  <th className="px-3 py-3">Name</th>
                  <th className="px-3 py-3">Serial number</th>
                  <th className="px-3 py-3">Result</th>
                  <th className="px-3 py-3">Stock match</th>
                </tr>
              </thead>
              <tbody>
                {filteredResults.map((row, index) => (
                  <tr key={`${row.name}-${row.serial_number}-${index}`} className="border-t border-white/10">
                    <td className="px-3 py-3 text-white">{row.name}</td>
                    <td className="px-3 py-3 text-white">{row.serial_number}</td>
                    <td className="px-3 py-3"><ResultStatus status={row.status} /></td>
                    <td className="px-3 py-3 text-slate-400">
                      {row.status === "found_on_stock"
                        ? `${row.matched_by}: ${row.stock_serial_number || row.stock_part_code}`
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
