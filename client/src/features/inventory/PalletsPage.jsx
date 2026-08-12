import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Boxes,
  Lock,
  MapPin,
  Package,
  Plus,
  Printer,
  RefreshCw,
  ScanLine,
  Search,
  Unlock,
  Warehouse,
} from "lucide-react";
import { apiClient } from "../../services/api.js";

const inputClass = "w-full rounded-xl border border-bt-purple-lightest bg-white px-3 py-2.5 text-sm text-black outline-none transition focus:border-bt-purple focus:ring-2 focus:ring-bt-purple-lightest";
const primaryButton = "inline-flex items-center justify-center gap-2 rounded-xl bg-bt-purple px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-bt-purple-dark disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "inline-flex items-center justify-center gap-2 rounded-xl border border-bt-purple-lightest bg-white px-4 py-2.5 text-sm font-semibold text-bt-purple-darker transition hover:bg-bt-purple-lightest/40 disabled:opacity-50";

function Field({ label, children, hint }) {
  return (
    <label className="block space-y-1.5 text-sm font-medium text-bt-purple-darker">
      <span>{label}</span>
      {children}
      {hint ? <span className="block text-xs font-normal text-bt-grey-600">{hint}</span> : null}
    </label>
  );
}

function parseIdentifiers(value) {
  return [...new Set(String(value || "").split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean))];
}

function fmtDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-GB");
}

function Pill({ value }) {
  const text = String(value || "UNKNOWN");
  const style = text === "OPEN"
    ? "bg-emerald-100 text-emerald-800"
    : text === "SEALED" || text.includes("ENGINEERING")
      ? "bg-sky-100 text-sky-800"
      : text === "CLOSED"
        ? "bg-slate-200 text-slate-700"
        : "bg-bt-purple-lightest/60 text-bt-purple-darker";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>{text}</span>;
}

function Metric({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-bt-purple-lightest bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-bt-grey-600">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-bt-purple-darker">{Number(value || 0).toLocaleString()}</p>
      {hint ? <p className="mt-2 text-xs text-bt-grey-600">{hint}</p> : null}
    </div>
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function printPalletLabel(pallet, itemCount) {
  const popup = window.open("", "_blank", "width=720,height=520");
  if (!popup) return;
  popup.document.write(`<!doctype html><html><head><title>${escapeHtml(pallet.pallet_code)}</title><style>
    body{font-family:Arial,sans-serif;margin:0;padding:32px;color:#16143a}
    .label{border:4px solid #16143a;border-radius:18px;padding:30px;max-width:600px}
    .eyebrow{font-size:13px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#635bff}
    .code{font-size:48px;font-weight:800;letter-spacing:.04em;margin:18px 0}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;font-size:16px}
    .value{font-weight:700}.hint{font-size:12px;color:#666;margin-top:26px}
    @media print{button{display:none}body{padding:0}.label{border-color:#000}}
  </style></head><body><div class="label">
    <div class="eyebrow">Inventory & Warehouse · Pallet Handling Unit</div>
    <div class="code">${escapeHtml(pallet.pallet_code)}</div>
    <div class="grid">
      <div>Project<br><span class="value">${escapeHtml(pallet.project_code)} · ${escapeHtml(pallet.project_name)}</span></div>
      <div>Contents<br><span class="value">${escapeHtml(itemCount)} serialized kits</span></div>
      <div>Location<br><span class="value">${escapeHtml(pallet.location_code)}</span></div>
      <div>Custody<br><span class="value">${escapeHtml(pallet.current_custody)}</span></div>
    </div>
    <div class="hint">Scan/search this pallet using the pallet code. Individual kits retain their own serial numbers and XXXYYY-0000 part codes.</div>
    <button onclick="window.print()" style="margin-top:20px;padding:10px 18px">Print</button>
  </div></body></html>`);
  popup.document.close();
}

export function PalletsPage({ auth }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [selectedPalletId, setSelectedPalletId] = useState(null);
  const [createForm, setCreateForm] = useState({ projectId: "", locationId: "", description: "", identifiers: "" });
  const [addForm, setAddForm] = useState({ identifiers: "", reason: "Add kits to pallet" });
  const [removeForm, setRemoveForm] = useState({ identifiers: "", reason: "Remove kits from pallet" });
  const [moveForm, setMoveForm] = useState({ toLocationId: "", reference: "", reason: "Pallet location movement" });

  const metaQuery = useQuery({
    queryKey: ["inventory", "pallets", "meta"],
    queryFn: () => apiClient.get("/v1/inventory/pallets/meta"),
  });
  const palletsQuery = useQuery({
    queryKey: ["inventory", "pallets", submittedSearch],
    queryFn: () => apiClient.get(`/v1/inventory/pallets?q=${encodeURIComponent(submittedSearch)}&limit=200`),
  });
  const detailQuery = useQuery({
    queryKey: ["inventory", "pallet", selectedPalletId],
    queryFn: () => apiClient.get(`/v1/inventory/pallets/${selectedPalletId}`),
    enabled: Boolean(selectedPalletId),
  });

  const mutation = useMutation({
    mutationFn: ({ path, body }) => apiClient.post(path, body),
    onSuccess: async (data, variables) => {
      setNotice({ tone: "success", text: variables.successMessage || "Pallet updated." });
      if (data?.pallet?.id) setSelectedPalletId(data.pallet.id);
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (error) => setNotice({ tone: "error", text: error.message || "Pallet operation failed." }),
  });

  const meta = metaQuery.data || {};
  const access = meta.access || {};
  const pallets = palletsQuery.data?.pallets || [];
  const detail = detailQuery.data || {};
  const selected = detail.pallet;
  const items = detail.items || [];

  const validProjects = useMemo(
    () => (meta.projects || []).filter((project) => /^[A-Z0-9]{3}$/.test(String(project.suffix || "").toUpperCase())),
    [meta.projects],
  );
  const moveLocations = useMemo(() => meta.locations || [], [meta.locations]);
  const creationLocations = useMemo(
    () => (meta.locations || []).filter((location) => access.mode === "STORES" && location.location_type !== "ENGINEERING_HANDOVER"),
    [meta.locations, access.mode],
  );

  const run = (path, body, successMessage) => mutation.mutate({ path, body, successMessage });

  const createPallet = (event) => {
    event.preventDefault();
    run("/v1/inventory/pallets", {
      projectId: Number(createForm.projectId),
      locationId: Number(createForm.locationId),
      description: createForm.description || undefined,
      identifiers: parseIdentifiers(createForm.identifiers),
      reason: "Initial pallet build",
    }, "Pallet created and pallet part code generated.");
  };

  if (metaQuery.isLoading) {
    return <section className="glass-panel rounded-[2rem] border border-white/10 p-8 text-white shadow-panel">Loading pallets...</section>;
  }
  if (metaQuery.isError) {
    return <section className="rounded-[2rem] border border-rose-200 bg-rose-50 p-8 text-rose-800">{metaQuery.error.message}</section>;
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[2rem] border border-bt-purple-lightest bg-white shadow-panel">
        <div className="bg-gradient-to-r from-bt-purple-darker via-bt-purple to-bt-purple-mid p-6 text-white md:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-bt-purple-lightest">Pallet Handling Units</p>
              <h2 className="mt-2 text-3xl font-semibold">Project-linked pallet control</h2>
              <p className="mt-2 max-w-3xl text-sm text-white/80">
                A pallet receives its own <span className="font-mono font-semibold text-white">XXXPLT-0000</span> code. Every kit inside still retains its permanent serial number and project-specific <span className="font-mono">XXXYYY-0000</span> part code.
              </p>
            </div>
            <div className="rounded-2xl bg-white/10 px-4 py-3 text-sm">
              <p className="font-semibold">{auth?.employee?.name}</p>
              <p className="text-white/70">{access.mode} · pallet movement enabled</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total Pallets" value={meta.metrics?.total} hint="All active pallet identities" />
        <Metric label="Open" value={meta.metrics?.open} hint="Contents can be changed" />
        <Metric label="Sealed" value={meta.metrics?.sealed} hint="Contents locked" />
        <Metric label="With Engineering" value={meta.metrics?.withEngineering} hint="Engineering custody" />
      </div>

      {notice ? (
        <div className={`rounded-xl border px-4 py-3 text-sm ${notice.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          {notice.text}
        </div>
      ) : null}

      <section className="rounded-2xl border border-bt-purple-lightest bg-white p-4 shadow-sm">
        <form className="flex flex-col gap-3 md:flex-row" onSubmit={(event) => { event.preventDefault(); setSubmittedSearch(searchInput.trim()); }}>
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-3 text-bt-purple" />
            <input className={`${inputClass} pl-10 font-mono`} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Scan/search pallet code, project or location..." />
          </div>
          <button className={primaryButton} type="submit"><Search size={16} /> Search</button>
          <button className={secondaryButton} type="button" onClick={() => queryClient.invalidateQueries({ queryKey: ["inventory"] })}><RefreshCw size={16} /> Refresh</button>
        </form>
      </section>

      {access.canCreate ? (
        <form className="rounded-2xl border border-bt-purple-lightest bg-white p-6 shadow-sm" onSubmit={createPallet}>
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-bt-purple-lightest/50 p-2 text-bt-purple"><Plus size={20} /></div>
            <div><h3 className="text-lg font-semibold text-bt-purple-darker">Create pallet</h3><p className="text-sm text-bt-grey-600">The backend generates the next project pallet code automatically.</p></div>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <Field label="Project"><select required className={inputClass} value={createForm.projectId} onChange={(event) => setCreateForm({ ...createForm, projectId: event.target.value })}><option value="">Select project</option>{validProjects.map((project) => <option key={project.id} value={project.id}>{project.ja_code} · {project.project_name} · {project.suffix}</option>)}</select></Field>
            <Field label="Initial pallet location"><select required className={inputClass} value={createForm.locationId} onChange={(event) => setCreateForm({ ...createForm, locationId: event.target.value })}><option value="">Select location</option>{creationLocations.map((location) => <option key={location.id} value={location.id}>{location.location_code} · {location.location_type}</option>)}</select></Field>
            <Field label="Description"><input className={inputClass} value={createForm.description} onChange={(event) => setCreateForm({ ...createForm, description: event.target.value })} placeholder="Optional handling note" /></Field>
            <div className="lg:col-span-3"><Field label="Initial kit serials / part codes" hint="Optional. Every scanned kit must already be in the selected pallet location and belong to the selected project."><textarea className={`${inputClass} min-h-28 font-mono`} value={createForm.identifiers} onChange={(event) => setCreateForm({ ...createForm, identifiers: event.target.value })} placeholder="One serial or part code per line" /></Field></div>
          </div>
          <button disabled={mutation.isPending} className={`${primaryButton} mt-5`} type="submit"><Package size={17} /> Generate Pallet Code</button>
        </form>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.35fr]">
        <section className="rounded-2xl border border-bt-purple-lightest bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3"><Boxes className="text-bt-purple" size={20} /><div><h3 className="text-lg font-semibold text-bt-purple-darker">Pallets</h3><p className="text-sm text-bt-grey-600">Select a pallet to manage contents and movement.</p></div></div>
          <div className="mt-4 space-y-2">
            {pallets.length ? pallets.map((pallet) => (
              <button key={pallet.id} type="button" onClick={() => setSelectedPalletId(pallet.id)} className={`w-full rounded-xl border p-4 text-left transition ${Number(selectedPalletId) === Number(pallet.id) ? "border-bt-purple bg-bt-purple-lightest/25" : "border-bt-purple-lightest hover:bg-bt-purple-lightest/15"}`}>
                <div className="flex items-start justify-between gap-3"><div><p className="font-mono text-base font-bold text-bt-purple-darker">{pallet.pallet_code}</p><p className="mt-1 text-sm text-black">{pallet.project_code} · {pallet.project_name}</p></div><Pill value={pallet.pallet_status} /></div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-bt-grey-600"><span>{pallet.item_count} kits</span><span>{pallet.location_code}</span><span>{pallet.current_custody}</span></div>
              </button>
            )) : <div className="rounded-xl border border-dashed border-bt-purple-lightest p-8 text-center text-sm text-bt-grey-600">No pallets found.</div>}
          </div>
        </section>

        <section className="rounded-2xl border border-bt-purple-lightest bg-white p-5 shadow-sm">
          {!selectedPalletId ? (
            <div className="flex min-h-80 flex-col items-center justify-center text-center"><Warehouse size={42} className="text-bt-purple-light" /><h3 className="mt-4 text-lg font-semibold text-bt-purple-darker">Select a pallet</h3><p className="mt-1 max-w-md text-sm text-bt-grey-600">Open a pallet to see its label, contents, movement controls and full pallet history.</p></div>
          ) : detailQuery.isLoading ? <p className="p-8 text-sm">Loading pallet...</p> : selected ? (
            <div className="space-y-6">
              <div className="rounded-2xl bg-gradient-to-br from-bt-purple-darker to-bt-purple p-6 text-white">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div><p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/65">Pallet Part Code</p><p className="mt-2 font-mono text-4xl font-bold tracking-wide">{selected.pallet_code}</p><p className="mt-3 text-sm text-white/80">{selected.project_code} · {selected.project_name}</p></div>
                  <div className="flex flex-wrap gap-2"><Pill value={selected.pallet_status} /><Pill value={selected.current_custody} /><button type="button" className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-bt-purple-darker" onClick={() => printPalletLabel(selected, items.length)}><Printer size={16} /> Print Label</button></div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-white/10 p-3"><p className="text-xs text-white/60">Contents</p><p className="mt-1 text-xl font-semibold">{items.length} kits</p></div><div className="rounded-xl bg-white/10 p-3"><p className="text-xs text-white/60">Location</p><p className="mt-1 font-mono font-semibold">{selected.location_code}</p></div><div className="rounded-xl bg-white/10 p-3"><p className="text-xs text-white/60">Project suffix</p><p className="mt-1 font-mono text-xl font-semibold">{selected.project_suffix}</p></div></div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-3"><h4 className="font-semibold text-bt-purple-darker">Pallet contents</h4><span className="text-xs text-bt-grey-600">Individual kit identity remains unchanged</span></div>
                <div className="mt-3 overflow-x-auto rounded-xl border border-bt-purple-lightest">
                  <table className="min-w-full text-sm"><thead className="bg-bt-purple-lightest/25"><tr><th className="px-3 py-2 text-left">Part Code</th><th className="px-3 py-2 text-left">Serial</th><th className="px-3 py-2 text-left">Kit</th><th className="px-3 py-2 text-left">Status</th></tr></thead><tbody className="divide-y divide-bt-grey-200">{items.map((item) => <tr key={item.asset_id}><td className="px-3 py-2 font-mono font-semibold">{item.part_code}</td><td className="px-3 py-2 font-mono">{item.serial_number}</td><td className="px-3 py-2">{item.kit_type_code} · {item.part_description}</td><td className="px-3 py-2"><Pill value={item.stock_status} /></td></tr>)}</tbody></table>
                </div>
              </div>

              {access.canManageContents ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <form className="rounded-xl border border-bt-purple-lightest p-4" onSubmit={(event) => { event.preventDefault(); run(`/v1/inventory/pallets/${selected.id}/items`, { identifiers: parseIdentifiers(addForm.identifiers), reason: addForm.reason }, "Kits added to pallet."); }}><h4 className="font-semibold text-bt-purple-darker">Add kits</h4><textarea required className={`${inputClass} mt-3 min-h-24 font-mono`} value={addForm.identifiers} onChange={(event) => setAddForm({ ...addForm, identifiers: event.target.value })} placeholder="Scan serial / part codes" /><button disabled={mutation.isPending || selected.pallet_status !== "OPEN"} className={`${primaryButton} mt-3`} type="submit"><ScanLine size={16} /> Add to Pallet</button></form>
                  <form className="rounded-xl border border-bt-purple-lightest p-4" onSubmit={(event) => { event.preventDefault(); run(`/v1/inventory/pallets/${selected.id}/items/remove`, { identifiers: parseIdentifiers(removeForm.identifiers), reason: removeForm.reason }, "Kits removed from pallet."); }}><h4 className="font-semibold text-bt-purple-darker">Remove kits</h4><textarea required className={`${inputClass} mt-3 min-h-24 font-mono`} value={removeForm.identifiers} onChange={(event) => setRemoveForm({ ...removeForm, identifiers: event.target.value })} placeholder="Scan serial / part codes" /><button disabled={mutation.isPending || selected.pallet_status !== "OPEN"} className={`${secondaryButton} mt-3`} type="submit">Remove from Pallet</button></form>
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                <form className="rounded-xl border border-bt-purple-lightest p-4" onSubmit={(event) => { event.preventDefault(); run(`/v1/inventory/pallets/${selected.id}/move`, { ...moveForm, toLocationId: Number(moveForm.toLocationId) }, "Pallet and all contained kits moved."); }}><div className="flex items-start gap-3"><MapPin size={20} className="text-bt-purple" /><div><h4 className="font-semibold text-bt-purple-darker">Move entire pallet</h4><p className="text-xs text-bt-grey-600">One pallet transaction writes an item-level movement for every contained kit.</p></div></div><div className="mt-4 grid gap-3 md:grid-cols-2"><Field label="Destination"><select required className={inputClass} value={moveForm.toLocationId} onChange={(event) => setMoveForm({ ...moveForm, toLocationId: event.target.value })}><option value="">Select destination</option>{moveLocations.filter((location) => Number(location.id) !== Number(selected.current_location_id)).map((location) => <option key={location.id} value={location.id}>{location.location_code} · {location.location_type}{location.assigned_employee_name ? ` · ${location.assigned_employee_name}` : ""}</option>)}</select></Field><Field label="Reference"><input className={inputClass} value={moveForm.reference} onChange={(event) => setMoveForm({ ...moveForm, reference: event.target.value })} /></Field><div className="md:col-span-2"><Field label="Reason"><textarea required className={inputClass} value={moveForm.reason} onChange={(event) => setMoveForm({ ...moveForm, reason: event.target.value })} /></Field></div></div><button disabled={mutation.isPending || !access.canMove} className={`${primaryButton} mt-3`} type="submit"><ArrowRightLeft size={16} /> Move Pallet</button></form>

                {access.canManageContents ? <div className="rounded-xl border border-bt-purple-lightest p-4"><h4 className="font-semibold text-bt-purple-darker">Contents lock</h4><p className="mt-1 max-w-xs text-xs text-bt-grey-600">Seal a completed pallet to prevent kits being added or removed while it is being handled.</p>{selected.pallet_status === "OPEN" ? <button type="button" disabled={mutation.isPending} onClick={() => run(`/v1/inventory/pallets/${selected.id}/status`, { status: "SEALED" }, "Pallet sealed.")} className={`${secondaryButton} mt-4`}><Lock size={16} /> Seal</button> : selected.pallet_status === "SEALED" ? <button type="button" disabled={mutation.isPending} onClick={() => run(`/v1/inventory/pallets/${selected.id}/status`, { status: "OPEN" }, "Pallet reopened.")} className={`${secondaryButton} mt-4`}><Unlock size={16} /> Reopen</button> : null}</div> : null}
              </div>

              <div><h4 className="font-semibold text-bt-purple-darker">Pallet movement history</h4><div className="mt-3 space-y-2">{(detail.movements || []).length ? detail.movements.map((movement) => <div key={movement.id} className="rounded-xl border border-bt-purple-lightest p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono font-semibold">{movement.from_location_code} → {movement.to_location_code}</span><span className="text-xs text-bt-grey-600">{fmtDate(movement.moved_at)}</span></div><p className="mt-1 text-xs text-bt-grey-600">{movement.from_custody} → {movement.to_custody} · {movement.performed_by_name} · {movement.reason || "Pallet movement"}</p></div>) : <p className="text-sm text-bt-grey-600">No pallet movements recorded yet.</p>}</div></div>
            </div>
          ) : null}
        </section>
      </div>

      <section className="rounded-2xl border border-bt-purple-lightest bg-bt-grey-50 p-5 text-sm text-bt-grey-600">
        <strong className="text-bt-purple-darker">Identity rule:</strong> pallet <code>WALPLT-0001</code> may contain kits such as <code>WALRTR-0047</code> and <code>WALSWI-0018</code>. Moving the pallet never replaces or changes those individual kit part codes.
      </section>
    </div>
  );
}
