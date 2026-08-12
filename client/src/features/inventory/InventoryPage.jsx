import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRightLeft,
  Boxes,
  ClipboardList,
  History,
  MapPin,
  PackageCheck,
  PackageSearch,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  Warehouse,
} from "lucide-react";
import { apiClient } from "../../services/api.js";

const tabs = [
  ["dashboard", "Dashboard", Boxes],
  ["assets", "Assets", PackageSearch],
  ["receive", "Register Stock", Plus],
  ["move", "Move Stock", ArrowRightLeft],
  ["handovers", "Engineering Custody", ClipboardList],
  ["shipping", "Shipping", Truck],
  ["movements", "Movements", History],
  ["audit", "Audit", ShieldCheck],
  ["admin", "Setup", Warehouse],
];

const assetStatusOptions = [
  "AVAILABLE",
  "RESERVED",
  "PICKED",
  "READY_FOR_HANDOVER",
  "RETURNED",
  "READY_TO_PACK",
  "QUARANTINE",
  "DAMAGED",
];

const locationTypeOptions = [
  "RECEIVING",
  "STORAGE",
  "PICKING",
  "ENGINEERING_HANDOVER",
  "ENGINEERING_CUSTODY",
  "RETURNS",
  "QUARANTINE",
  "PACKING",
  "DISPATCH",
];

function parseIdentifiers(value) {
  return [...new Set(String(value || "").split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean))];
}

function fmtDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString("en-GB");
}

function StatusPill({ value }) {
  const text = String(value || "UNKNOWN");
  const className = text.includes("AVAILABLE") || text.includes("DELIVERED") || text.includes("RECEIVED")
    ? "bg-emerald-100 text-emerald-800"
    : text.includes("QUARANTINE") || text.includes("DAMAGED") || text.includes("FAILED")
      ? "bg-rose-100 text-rose-800"
      : text.includes("ENGINEERING") || text.includes("TRANSIT")
        ? "bg-sky-100 text-sky-800"
        : text.includes("RESERVED") || text.includes("PICKED") || text.includes("PACKED")
          ? "bg-amber-100 text-amber-800"
          : "bg-bt-purple-lightest/60 text-bt-purple-darker";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>{text}</span>;
}

function MetricCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-bt-purple-lightest bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-bt-grey-600">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-bt-purple-darker">{Number(value || 0).toLocaleString()}</p>
      {hint ? <p className="mt-2 text-xs text-bt-grey-600">{hint}</p> : null}
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="block space-y-1.5 text-sm font-medium text-bt-purple-darker">
      <span>{label}</span>
      {children}
      {hint ? <span className="block text-xs font-normal text-bt-grey-600">{hint}</span> : null}
    </label>
  );
}

const inputClass = "w-full rounded-xl border border-bt-purple-lightest bg-white px-3 py-2.5 text-sm text-black outline-none transition focus:border-bt-purple focus:ring-2 focus:ring-bt-purple-lightest";
const buttonPrimary = "inline-flex items-center justify-center gap-2 rounded-xl bg-bt-purple px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-bt-purple-dark disabled:cursor-not-allowed disabled:opacity-50";
const buttonSecondary = "inline-flex items-center justify-center gap-2 rounded-xl border border-bt-purple-lightest bg-white px-4 py-2.5 text-sm font-semibold text-bt-purple-darker transition hover:bg-bt-purple-lightest/40 disabled:opacity-50";

function EmptyState({ children }) {
  return <div className="rounded-2xl border border-dashed border-bt-purple-lightest bg-white/70 p-8 text-center text-sm text-bt-grey-600">{children}</div>;
}

function DataTable({ columns, rows, onRowClick }) {
  if (!rows?.length) return <EmptyState>No records found.</EmptyState>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-bt-purple-lightest bg-white">
      <table className="min-w-full divide-y divide-bt-purple-lightest text-sm">
        <thead className="bg-bt-purple-lightest/25">
          <tr>{columns.map((column) => <th key={column.key} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-bt-purple-darker">{column.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-bt-grey-200">
          {rows.map((row, index) => (
            <tr key={row.id || row.movement_reference || row.handover_reference || index} onClick={() => onRowClick?.(row)} className={onRowClick ? "cursor-pointer hover:bg-bt-purple-lightest/20" : ""}>
              {columns.map((column) => <td key={column.key} className="whitespace-nowrap px-4 py-3 align-top text-black">{column.render ? column.render(row) : row[column.key] ?? "—"}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InventoryPage({ auth }) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [notice, setNotice] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState(null);

  const metaQuery = useQuery({ queryKey: ["inventory", "meta"], queryFn: () => apiClient.get("/v1/inventory/meta") });
  const dashboardQuery = useQuery({ queryKey: ["inventory", "dashboard"], queryFn: () => apiClient.get("/v1/inventory/dashboard") });
  const assetsQuery = useQuery({ queryKey: ["inventory", "assets"], queryFn: () => apiClient.get("/v1/inventory/assets?limit=100") });
  const handoversQuery = useQuery({ queryKey: ["inventory", "handovers"], queryFn: () => apiClient.get("/v1/inventory/handovers?limit=100") });
  const shipmentsQuery = useQuery({ queryKey: ["inventory", "shipments"], queryFn: () => apiClient.get("/v1/inventory/shipments?limit=100") });
  const movementsQuery = useQuery({ queryKey: ["inventory", "movements"], queryFn: () => apiClient.get("/v1/inventory/movements?limit=100") });
  const auditQuery = useQuery({
    queryKey: ["inventory", "audit"],
    queryFn: () => apiClient.get("/v1/inventory/audit?limit=100"),
    enabled: Boolean(metaQuery.data?.access?.canViewAudit),
  });
  const searchQuery = useQuery({
    queryKey: ["inventory", "search", submittedSearch],
    queryFn: () => apiClient.get(`/v1/inventory/search?q=${encodeURIComponent(submittedSearch)}&limit=50`),
    enabled: Boolean(submittedSearch),
  });
  const assetDetailQuery = useQuery({
    queryKey: ["inventory", "asset", selectedAssetId],
    queryFn: () => apiClient.get(`/v1/inventory/assets/${selectedAssetId}`),
    enabled: Boolean(selectedAssetId),
  });

  const action = useMutation({
    mutationFn: ({ path, body = {} }) => apiClient.post(path, body),
    onSuccess: async (_data, variables) => {
      setNotice({ tone: "success", message: variables.successMessage || "Inventory updated successfully." });
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (error) => setNotice({ tone: "error", message: error.message || "Inventory operation failed." }),
  });

  const meta = metaQuery.data || {};
  const access = meta.access || {};
  const validProjects = useMemo(() => (meta.projects || []).filter((project) => /^[A-Z0-9]{3}$/.test(String(project.suffix || "").toUpperCase())), [meta.projects]);
  const serializedParts = useMemo(() => (meta.parts || []).filter((part) => Boolean(part.serialized)), [meta.parts]);
  const quantityParts = useMemo(() => (meta.parts || []).filter((part) => !Boolean(part.serialized)), [meta.parts]);

  const [assetForm, setAssetForm] = useState({ serialNumber: "", inventoryPartId: "", projectId: "", locationId: "", conditionStatus: "GOOD", reference: "", reason: "" });
  const [moveForm, setMoveForm] = useState({ identifier: "", toLocationId: "", stockStatus: "AVAILABLE", reason: "Stores location transfer", reference: "" });
  const [adjustForm, setAdjustForm] = useState({ inventoryPartId: "", locationId: "", quantityDelta: "", reason: "", reference: "" });
  const [handoverForm, setHandoverForm] = useState({ direction: "STORES_TO_ENGINEERING", projectId: "", identifiers: "", fromLocationId: "", toLocationId: "", notes: "" });
  const [shipmentForm, setShipmentForm] = useState({ projectId: "", identifiers: "", destinationName: "", destinationContact: "", destinationAddress: "", courierId: "", courierService: "", trackingNumber: "", consignmentNumber: "", packingLocationId: "" });
  const [trackingForm, setTrackingForm] = useState({ shipmentId: "", courierStatus: "IN_TRANSIT", eventDescription: "", eventLocation: "", eventTimestamp: new Date().toISOString().slice(0, 16) });
  const [kitTypeForm, setKitTypeForm] = useState({ code: "", name: "", description: "" });
  const [partForm, setPartForm] = useState({ manufacturerPartCode: "", partDescription: "", manufacturer: "", model: "", kitTypeId: "", userGroupId: "", serialized: true, stockType: "STANDARD", unitOfMeasure: "EA" });
  const [warehouseForm, setWarehouseForm] = useState({ code: "", name: "", description: "" });
  const [locationForm, setLocationForm] = useState({ warehouseId: "", storeNumber: "", aisle: "", shelf: "", bin: "", locationCode: "", description: "", locationType: "STORAGE" });
  const [courierForm, setCourierForm] = useState({ courierName: "", accountReference: "", contactName: "", contactPhone: "", contactEmail: "", trackingUrlTemplate: "" });

  const run = (path, body, successMessage) => action.mutate({ path, body, successMessage });

  const visibleTabs = tabs.filter(([key]) => {
    if (key === "audit") return access.canViewAudit;
    if (["receive", "move", "admin"].includes(key)) return access.canManageStock;
    return true;
  });

  if (metaQuery.isLoading) {
    return <section className="glass-panel rounded-[2rem] border border-white/10 p-8 shadow-panel">Loading Inventory & Warehouse...</section>;
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
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-bt-purple-lightest">Inventory & Warehouse</p>
              <h2 className="mt-2 text-3xl font-semibold">Stores-controlled project stock</h2>
              <p className="mt-2 max-w-3xl text-sm text-white/80">Serialized assets use permanent serial numbers and project-linked <span className="font-mono font-semibold text-white">XXXYYY-0000</span> part codes. Engineering is tracked only as team custody.</p>
            </div>
            <div className="rounded-2xl bg-white/10 px-4 py-3 text-sm">
              <p className="font-semibold">{auth?.employee?.name}</p>
              <p className="text-white/70">{auth?.employee?.team_name || auth?.employee?.role} · EIN {auth?.employee?.ein || "—"}</p>
            </div>
          </div>
        </div>

        <div className="border-b border-bt-purple-lightest bg-bt-grey-50 px-4 py-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {visibleTabs.map(([key, label, Icon]) => (
              <button key={key} type="button" onClick={() => setActiveTab(key)} className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${activeTab === key ? "bg-bt-purple text-white" : "bg-white text-bt-purple-darker hover:bg-bt-purple-lightest/40"}`}>
                <Icon size={16} /> {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {notice ? (
        <div className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm ${notice.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          <span>{notice.message}</span><button type="button" onClick={() => setNotice(null)} className="font-semibold">Dismiss</button>
        </div>
      ) : null}

      <section className="rounded-2xl border border-bt-purple-lightest bg-white p-4 shadow-sm">
        <form className="flex flex-col gap-3 md:flex-row" onSubmit={(event) => { event.preventDefault(); setSubmittedSearch(searchInput.trim()); }}>
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-3 text-bt-purple" />
            <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} className={`${inputClass} pl-10 font-mono`} placeholder="Scan or search serial, current/old part code, project, MPN, model or location..." />
          </div>
          <button className={buttonPrimary} type="submit"><Search size={16} /> Search</button>
          <button className={buttonSecondary} type="button" onClick={() => queryClient.invalidateQueries({ queryKey: ["inventory"] })}><RefreshCw size={16} /> Refresh</button>
        </form>
        {submittedSearch ? (
          <div className="mt-4">
            <DataTable columns={[
              { key: "part_code", label: "Part Code", render: (row) => <span className="font-mono font-semibold text-bt-purple-darker">{row.part_code}</span> },
              { key: "serial_number", label: "Serial", render: (row) => <span className="font-mono">{row.serial_number}</span> },
              { key: "part_description", label: "Description" },
              { key: "project_code", label: "Project" },
              { key: "stock_status", label: "Status", render: (row) => <StatusPill value={row.stock_status} /> },
              { key: "current_custody", label: "Custody", render: (row) => <StatusPill value={row.current_custody} /> },
              { key: "location_code", label: "Location" },
            ]} rows={searchQuery.data?.results || []} onRowClick={(row) => { setSelectedAssetId(row.id); setActiveTab("assets"); }} />
          </div>
        ) : null}
      </section>

      {activeTab === "dashboard" ? (
        <div className="space-y-6">
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard label="Total Assets" value={dashboardQuery.data?.metrics?.totalAssets} />
            <MetricCard label="Available" value={dashboardQuery.data?.metrics?.available} />
            <MetricCard label="Reserved" value={dashboardQuery.data?.metrics?.reserved} />
            <MetricCard label="Picked" value={dashboardQuery.data?.metrics?.picked} />
            <MetricCard label="With Engineering" value={dashboardQuery.data?.metrics?.withEngineering} />
            <MetricCard label="Awaiting Return" value={dashboardQuery.data?.metrics?.awaitingReturn} />
            <MetricCard label="Ready to Pack" value={dashboardQuery.data?.metrics?.readyToPack} />
            <MetricCard label="Ready to Ship" value={dashboardQuery.data?.metrics?.readyToShip} />
            <MetricCard label="In Transit" value={dashboardQuery.data?.metrics?.inTransit} />
            <MetricCard label="Quarantine" value={dashboardQuery.data?.metrics?.quarantine} />
          </section>
          <section className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-2xl border border-bt-purple-lightest bg-white p-5">
              <h3 className="font-semibold text-bt-purple-darker">Recent stock movements</h3>
              <div className="mt-4"><DataTable columns={[
                { key: "movement_reference", label: "Reference" }, { key: "movement_type", label: "Type", render: (row) => <StatusPill value={row.movement_type} /> },
                { key: "project_code", label: "Project" }, { key: "performed_by_name", label: "By" }, { key: "movement_date", label: "When", render: (row) => fmtDate(row.movement_date) },
              ]} rows={dashboardQuery.data?.recentMovements || []} /></div>
            </div>
            <div className="rounded-2xl border border-bt-purple-lightest bg-white p-5">
              <h3 className="font-semibold text-bt-purple-darker">Active shipping queue</h3>
              <div className="mt-4"><DataTable columns={[
                { key: "shipment_reference", label: "Shipment" }, { key: "project_code", label: "Project" },
                { key: "shipment_status", label: "Status", render: (row) => <StatusPill value={row.shipment_status} /> }, { key: "tracking_number", label: "Tracking" },
              ]} rows={dashboardQuery.data?.activeShipments || []} /></div>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "assets" ? (
        <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
          <div>
            <DataTable columns={[
              { key: "part_code", label: "Part Code", render: (row) => <span className="font-mono font-semibold text-bt-purple-darker">{row.part_code}</span> },
              { key: "serial_number", label: "Serial", render: (row) => <span className="font-mono">{row.serial_number}</span> },
              { key: "part_description", label: "Description" }, { key: "project_code", label: "Project" },
              { key: "stock_status", label: "Status", render: (row) => <StatusPill value={row.stock_status} /> },
              { key: "current_custody", label: "Custody", render: (row) => <StatusPill value={row.current_custody} /> }, { key: "location_code", label: "Location" },
            ]} rows={assetsQuery.data?.items || []} onRowClick={(row) => setSelectedAssetId(row.id)} />
          </div>
          <aside className="rounded-2xl border border-bt-purple-lightest bg-white p-5">
            <h3 className="text-lg font-semibold text-bt-purple-darker">Asset 360°</h3>
            {!selectedAssetId ? <p className="mt-4 text-sm text-bt-grey-600">Select an asset to see its complete identity and movement history.</p> : assetDetailQuery.isLoading ? <p className="mt-4 text-sm">Loading asset...</p> : (
              <div className="mt-4 space-y-5 text-sm">
                <div className="rounded-xl bg-bt-purple-lightest/20 p-4">
                  <p className="font-mono text-lg font-semibold text-bt-purple-darker">{assetDetailQuery.data?.asset?.part_code}</p>
                  <p className="mt-1 font-mono text-black">{assetDetailQuery.data?.asset?.serial_number}</p>
                  <div className="mt-3 flex flex-wrap gap-2"><StatusPill value={assetDetailQuery.data?.asset?.stock_status} /><StatusPill value={assetDetailQuery.data?.asset?.current_custody} /></div>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <dt className="text-bt-grey-600">Project</dt><dd>{assetDetailQuery.data?.asset?.project_code}</dd>
                  <dt className="text-bt-grey-600">Suffix</dt><dd>{assetDetailQuery.data?.asset?.project_suffix}</dd>
                  <dt className="text-bt-grey-600">Kit type</dt><dd>{assetDetailQuery.data?.asset?.kit_type_code}</dd>
                  <dt className="text-bt-grey-600">Manufacturer</dt><dd>{assetDetailQuery.data?.asset?.manufacturer || "—"}</dd>
                  <dt className="text-bt-grey-600">MPN</dt><dd>{assetDetailQuery.data?.asset?.manufacturer_part_code || "—"}</dd>
                  <dt className="text-bt-grey-600">Location</dt><dd>{assetDetailQuery.data?.asset?.location_code || "—"}</dd>
                </dl>
                <div>
                  <h4 className="font-semibold text-bt-purple-darker">Part-code history</h4>
                  <div className="mt-2 space-y-2">{(assetDetailQuery.data?.partCodeHistory || []).map((entry) => <div key={entry.id} className="rounded-lg border border-bt-purple-lightest p-3"><p className="font-mono">{entry.old_part_code || "Initial"} → <strong>{entry.new_part_code}</strong></p><p className="mt-1 text-xs text-bt-grey-600">{fmtDate(entry.changed_at)} · {entry.changed_by_name}</p></div>)}</div>
                </div>
              </div>
            )}
          </aside>
        </div>
      ) : null}

      {activeTab === "receive" && access.canManageStock ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <form className="rounded-2xl border border-bt-purple-lightest bg-white p-6" onSubmit={(event) => { event.preventDefault(); run("/v1/inventory/assets", { ...assetForm, inventoryPartId: Number(assetForm.inventoryPartId), projectId: Number(assetForm.projectId), locationId: Number(assetForm.locationId) }, "Serialized asset registered and project part code generated."); }}>
            <h3 className="text-lg font-semibold text-bt-purple-darker">Register serialized asset</h3>
            <p className="mt-1 text-sm text-bt-grey-600">Part code is generated automatically as XXXYYY-0000.</p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Field label="Serial number"><input autoFocus className={`${inputClass} font-mono`} required value={assetForm.serialNumber} onChange={(e) => setAssetForm({ ...assetForm, serialNumber: e.target.value })} /></Field>
              <Field label="Project"><select className={inputClass} required value={assetForm.projectId} onChange={(e) => setAssetForm({ ...assetForm, projectId: e.target.value })}><option value="">Select project</option>{validProjects.map((project) => <option key={project.id} value={project.id}>{project.ja_code} · {project.project_name} · {project.suffix}</option>)}</select></Field>
              <Field label="Part / kit type"><select className={inputClass} required value={assetForm.inventoryPartId} onChange={(e) => setAssetForm({ ...assetForm, inventoryPartId: e.target.value })}><option value="">Select part</option>{serializedParts.map((part) => <option key={part.id} value={part.id}>{part.kit_type_code} · {part.part_description} · {part.manufacturer_part_code || "No MPN"}</option>)}</select></Field>
              <Field label="Stores location"><select className={inputClass} required value={assetForm.locationId} onChange={(e) => setAssetForm({ ...assetForm, locationId: e.target.value })}><option value="">Select location</option>{(meta.locations || []).filter((location) => !location.location_type.includes("ENGINEERING")).map((location) => <option key={location.id} value={location.id}>{location.location_code}</option>)}</select></Field>
              <Field label="Condition"><input className={inputClass} value={assetForm.conditionStatus} onChange={(e) => setAssetForm({ ...assetForm, conditionStatus: e.target.value.toUpperCase() })} /></Field>
              <Field label="Reference"><input className={inputClass} value={assetForm.reference} onChange={(e) => setAssetForm({ ...assetForm, reference: e.target.value })} /></Field>
            </div>
            <button disabled={action.isPending} className={`${buttonPrimary} mt-5`} type="submit"><PackageCheck size={16} /> Register Asset</button>
          </form>

          <form className="rounded-2xl border border-bt-purple-lightest bg-white p-6" onSubmit={(event) => { event.preventDefault(); run("/v1/inventory/stock/adjust", { ...adjustForm, inventoryPartId: Number(adjustForm.inventoryPartId), locationId: Number(adjustForm.locationId), quantityDelta: Number(adjustForm.quantityDelta) }, "Quantity stock adjusted."); }}>
            <h3 className="text-lg font-semibold text-bt-purple-darker">Quantity stock adjustment</h3>
            <p className="mt-1 text-sm text-bt-grey-600">Non-serialized stock is changed only through an audited adjustment transaction.</p>
            <div className="mt-5 space-y-4">
              <Field label="Non-serialized part"><select className={inputClass} required value={adjustForm.inventoryPartId} onChange={(e) => setAdjustForm({ ...adjustForm, inventoryPartId: e.target.value })}><option value="">Select part</option>{quantityParts.map((part) => <option key={part.id} value={part.id}>{part.part_description}</option>)}</select></Field>
              <Field label="Location"><select className={inputClass} required value={adjustForm.locationId} onChange={(e) => setAdjustForm({ ...adjustForm, locationId: e.target.value })}><option value="">Select location</option>{(meta.locations || []).map((location) => <option key={location.id} value={location.id}>{location.location_code}</option>)}</select></Field>
              <Field label="Quantity adjustment" hint="Use a positive number for stock in and a negative number for stock out."><input className={inputClass} type="number" step="0.01" required value={adjustForm.quantityDelta} onChange={(e) => setAdjustForm({ ...adjustForm, quantityDelta: e.target.value })} /></Field>
              <Field label="Reason"><textarea className={inputClass} required value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })} /></Field>
            </div>
            <button disabled={action.isPending} className={`${buttonPrimary} mt-5`} type="submit">Post Adjustment</button>
          </form>
        </div>
      ) : null}

      {activeTab === "move" && access.canManageStock ? (
        <form className="mx-auto max-w-3xl rounded-2xl border border-bt-purple-lightest bg-white p-6" onSubmit={(event) => { event.preventDefault(); run("/v1/inventory/movements", { ...moveForm, toLocationId: Number(moveForm.toLocationId) }, "Stock moved successfully."); }}>
          <h3 className="text-lg font-semibold text-bt-purple-darker">Scanner-first Stores movement</h3>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Serial number or part code"><input autoFocus className={`${inputClass} font-mono text-lg`} required value={moveForm.identifier} onChange={(e) => setMoveForm({ ...moveForm, identifier: e.target.value })} /></Field>
            <Field label="Destination"><select className={inputClass} required value={moveForm.toLocationId} onChange={(e) => setMoveForm({ ...moveForm, toLocationId: e.target.value })}><option value="">Select location</option>{(meta.locations || []).filter((location) => !location.location_type.includes("ENGINEERING_CUSTODY")).map((location) => <option key={location.id} value={location.id}>{location.location_code} · {location.location_type}</option>)}</select></Field>
            <Field label="Stock status"><select className={inputClass} value={moveForm.stockStatus} onChange={(e) => setMoveForm({ ...moveForm, stockStatus: e.target.value })}>{assetStatusOptions.map((status) => <option key={status}>{status}</option>)}</select></Field>
            <Field label="Reference"><input className={inputClass} value={moveForm.reference} onChange={(e) => setMoveForm({ ...moveForm, reference: e.target.value })} /></Field>
            <div className="md:col-span-2"><Field label="Reason"><textarea className={inputClass} required value={moveForm.reason} onChange={(e) => setMoveForm({ ...moveForm, reason: e.target.value })} /></Field></div>
          </div>
          <button disabled={action.isPending} className={`${buttonPrimary} mt-5`} type="submit"><ArrowRightLeft size={16} /> Commit Movement</button>
        </form>
      ) : null}

      {activeTab === "handovers" ? (
        <div className="space-y-6">
          <form className="rounded-2xl border border-bt-purple-lightest bg-white p-6" onSubmit={(event) => { event.preventDefault(); run("/v1/inventory/handovers", { ...handoverForm, projectId: Number(handoverForm.projectId), identifiers: parseIdentifiers(handoverForm.identifiers), fromLocationId: handoverForm.fromLocationId ? Number(handoverForm.fromLocationId) : undefined, toLocationId: handoverForm.toLocationId ? Number(handoverForm.toLocationId) : undefined }, "Custody handover created."); }}>
            <div className="flex items-start gap-3"><div className="rounded-xl bg-bt-purple-lightest/40 p-2 text-bt-purple"><Warehouse size={20} /></div><div><h3 className="text-lg font-semibold text-bt-purple-darker">Team-level custody handover</h3><p className="text-sm text-bt-grey-600">No individual engineer staging or configuration is tracked.</p></div></div>
            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              <Field label="Direction"><select className={inputClass} value={handoverForm.direction} onChange={(e) => setHandoverForm({ ...handoverForm, direction: e.target.value })}>
                {access.canManageStock ? <option value="STORES_TO_ENGINEERING">Stores → Engineering</option> : null}
                {access.canCreateEngineeringReturn ? <option value="ENGINEERING_TO_STORES">Engineering → Stores</option> : null}
              </select></Field>
              <Field label="Project"><select className={inputClass} required value={handoverForm.projectId} onChange={(e) => setHandoverForm({ ...handoverForm, projectId: e.target.value })}><option value="">Select project</option>{validProjects.map((project) => <option key={project.id} value={project.id}>{project.ja_code} · {project.project_name}</option>)}</select></Field>
              <Field label="Destination location"><select className={inputClass} value={handoverForm.toLocationId} onChange={(e) => setHandoverForm({ ...handoverForm, toLocationId: e.target.value })}><option value="">Keep current / select</option>{(meta.locations || []).map((location) => <option key={location.id} value={location.id}>{location.location_code}</option>)}</select></Field>
              <div className="lg:col-span-3"><Field label="Scan serial numbers or part codes" hint="One per line, or comma-separated."><textarea className={`${inputClass} min-h-32 font-mono`} required value={handoverForm.identifiers} onChange={(e) => setHandoverForm({ ...handoverForm, identifiers: e.target.value })} /></Field></div>
            </div>
            <button disabled={action.isPending} className={`${buttonPrimary} mt-5`} type="submit">Create Handover</button>
          </form>
          <DataTable columns={[
            { key: "handover_reference", label: "Handover" }, { key: "direction", label: "Direction" }, { key: "project_code", label: "Project" },
            { key: "status", label: "Status", render: (row) => <StatusPill value={row.status} /> }, { key: "issued_by_name", label: "Issued By" }, { key: "issued_at", label: "Issued", render: (row) => fmtDate(row.issued_at) },
            { key: "action", label: "Action", render: (row) => row.status === "PENDING" ? <button type="button" onClick={(event) => { event.stopPropagation(); run(`/v1/inventory/handovers/${row.id}/receive`, row.direction === "ENGINEERING_TO_STORES" ? { outcome: "RETURNED" } : {}, "Handover received and custody updated."); }} className={buttonSecondary}>Receive</button> : "—" },
          ]} rows={handoversQuery.data?.handovers || []} />
        </div>
      ) : null}

      {activeTab === "shipping" ? (
        <div className="space-y-6">
          {access.canManageStock ? <form className="rounded-2xl border border-bt-purple-lightest bg-white p-6" onSubmit={(event) => { event.preventDefault(); run("/v1/inventory/shipments", { ...shipmentForm, projectId: Number(shipmentForm.projectId), identifiers: parseIdentifiers(shipmentForm.identifiers), courierId: shipmentForm.courierId ? Number(shipmentForm.courierId) : undefined, packingLocationId: shipmentForm.packingLocationId ? Number(shipmentForm.packingLocationId) : undefined }, "Shipment packed."); }}>
            <h3 className="text-lg font-semibold text-bt-purple-darker">Pack project shipment</h3>
            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              <Field label="Project"><select className={inputClass} required value={shipmentForm.projectId} onChange={(e) => setShipmentForm({ ...shipmentForm, projectId: e.target.value })}><option value="">Select project</option>{validProjects.map((project) => <option key={project.id} value={project.id}>{project.ja_code} · {project.project_name}</option>)}</select></Field>
              <Field label="Courier"><select className={inputClass} value={shipmentForm.courierId} onChange={(e) => setShipmentForm({ ...shipmentForm, courierId: e.target.value })}><option value="">Select courier</option>{(meta.couriers || []).map((courier) => <option key={courier.id} value={courier.id}>{courier.courier_name}</option>)}</select></Field>
              <Field label="Packing location"><select className={inputClass} value={shipmentForm.packingLocationId} onChange={(e) => setShipmentForm({ ...shipmentForm, packingLocationId: e.target.value })}><option value="">Select packing location</option>{(meta.locations || []).filter((location) => location.location_type === "PACKING").map((location) => <option key={location.id} value={location.id}>{location.location_code}</option>)}</select></Field>
              <Field label="Destination name"><input className={inputClass} required value={shipmentForm.destinationName} onChange={(e) => setShipmentForm({ ...shipmentForm, destinationName: e.target.value })} /></Field>
              <Field label="Destination contact"><input className={inputClass} value={shipmentForm.destinationContact} onChange={(e) => setShipmentForm({ ...shipmentForm, destinationContact: e.target.value })} /></Field>
              <Field label="Tracking number"><input className={`${inputClass} font-mono`} value={shipmentForm.trackingNumber} onChange={(e) => setShipmentForm({ ...shipmentForm, trackingNumber: e.target.value })} /></Field>
              <div className="lg:col-span-3"><Field label="Destination address"><textarea className={inputClass} required value={shipmentForm.destinationAddress} onChange={(e) => setShipmentForm({ ...shipmentForm, destinationAddress: e.target.value })} /></Field></div>
              <div className="lg:col-span-3"><Field label="Scan shipment items"><textarea className={`${inputClass} min-h-28 font-mono`} required value={shipmentForm.identifiers} onChange={(e) => setShipmentForm({ ...shipmentForm, identifiers: e.target.value })} /></Field></div>
            </div>
            <button disabled={action.isPending} className={`${buttonPrimary} mt-5`} type="submit"><PackageCheck size={16} /> Create Packed Shipment</button>
          </form> : null}

          <DataTable columns={[
            { key: "shipment_reference", label: "Shipment" }, { key: "project_code", label: "Project" }, { key: "courier_name", label: "Courier" },
            { key: "tracking_number", label: "Tracking", render: (row) => <span className="font-mono">{row.tracking_number || "—"}</span> }, { key: "shipment_status", label: "Status", render: (row) => <StatusPill value={row.shipment_status} /> },
            { key: "action", label: "Action", render: (row) => access.canManageStock && ["PACKED", "READY_TO_SHIP"].includes(row.shipment_status) ? <button type="button" className={buttonSecondary} onClick={(event) => { event.stopPropagation(); run(`/v1/inventory/shipments/${row.id}/dispatch`, {}, "Shipment dispatched."); }}>Dispatch</button> : "—" },
          ]} rows={shipmentsQuery.data?.shipments || []} />

          {access.canManageStock ? <form className="rounded-2xl border border-bt-purple-lightest bg-white p-6" onSubmit={(event) => { event.preventDefault(); run(`/v1/inventory/shipments/${trackingForm.shipmentId}/tracking-events`, { ...trackingForm, eventTimestamp: new Date(trackingForm.eventTimestamp).toISOString() }, "Tracking event recorded."); }}>
            <h3 className="text-lg font-semibold text-bt-purple-darker">Tracking update</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <Field label="Shipment"><select required className={inputClass} value={trackingForm.shipmentId} onChange={(e) => setTrackingForm({ ...trackingForm, shipmentId: e.target.value })}><option value="">Select shipment</option>{(shipmentsQuery.data?.shipments || []).map((shipment) => <option key={shipment.id} value={shipment.id}>{shipment.shipment_reference}</option>)}</select></Field>
              <Field label="Status"><select className={inputClass} value={trackingForm.courierStatus} onChange={(e) => setTrackingForm({ ...trackingForm, courierStatus: e.target.value })}><option>IN_TRANSIT</option><option>OUT_FOR_DELIVERY</option><option>DELIVERED</option><option>EXCEPTION</option></select></Field>
              <Field label="Event time"><input type="datetime-local" className={inputClass} value={trackingForm.eventTimestamp} onChange={(e) => setTrackingForm({ ...trackingForm, eventTimestamp: e.target.value })} /></Field>
              <Field label="Location"><input className={inputClass} value={trackingForm.eventLocation} onChange={(e) => setTrackingForm({ ...trackingForm, eventLocation: e.target.value })} /></Field>
            </div><button className={`${buttonPrimary} mt-5`} type="submit">Add Tracking Event</button>
          </form> : null}
        </div>
      ) : null}

      {activeTab === "movements" ? <DataTable columns={[
        { key: "movement_reference", label: "Movement" }, { key: "movement_type", label: "Type", render: (row) => <StatusPill value={row.movement_type} /> },
        { key: "project_code", label: "Project" }, { key: "from_location_code", label: "From" }, { key: "to_location_code", label: "To" },
        { key: "performed_by_name", label: "By" }, { key: "movement_date", label: "When", render: (row) => fmtDate(row.movement_date) },
      ]} rows={movementsQuery.data?.movements || []} /> : null}

      {activeTab === "audit" && access.canViewAudit ? <DataTable columns={[
        { key: "event_type", label: "Event", render: (row) => <StatusPill value={row.event_type} /> }, { key: "entity_type", label: "Entity" }, { key: "entity_id", label: "ID" },
        { key: "user_name", label: "User" }, { key: "ein", label: "EIN" }, { key: "correlation_id", label: "Correlation" }, { key: "created_at", label: "When", render: (row) => fmtDate(row.created_at) },
      ]} rows={auditQuery.data?.audit || []} /> : null}

      {activeTab === "admin" && access.canManageStock ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <form className="rounded-2xl border border-bt-purple-lightest bg-white p-6" onSubmit={(event) => { event.preventDefault(); run("/v1/inventory/kit-types", kitTypeForm, "Kit type saved."); }}><h3 className="font-semibold text-bt-purple-darker">Kit Type</h3><div className="mt-4 grid gap-3 md:grid-cols-2"><Field label="YYY code"><input className={`${inputClass} font-mono uppercase`} maxLength={3} required value={kitTypeForm.code} onChange={(e) => setKitTypeForm({ ...kitTypeForm, code: e.target.value.toUpperCase() })} /></Field><Field label="Name"><input className={inputClass} required value={kitTypeForm.name} onChange={(e) => setKitTypeForm({ ...kitTypeForm, name: e.target.value })} /></Field></div><button className={`${buttonPrimary} mt-4`} type="submit">Save Kit Type</button></form>
          <form className="rounded-2xl border border-bt-purple-lightest bg-white p-6" onSubmit={(event) => { event.preventDefault(); run("/v1/inventory/warehouses", warehouseForm, "Warehouse saved."); }}><h3 className="font-semibold text-bt-purple-darker">Warehouse</h3><div className="mt-4 grid gap-3 md:grid-cols-2"><Field label="Code"><input className={inputClass} required value={warehouseForm.code} onChange={(e) => setWarehouseForm({ ...warehouseForm, code: e.target.value.toUpperCase() })} /></Field><Field label="Name"><input className={inputClass} required value={warehouseForm.name} onChange={(e) => setWarehouseForm({ ...warehouseForm, name: e.target.value })} /></Field></div><button className={`${buttonPrimary} mt-4`} type="submit">Save Warehouse</button></form>
          <form className="rounded-2xl border border-bt-purple-lightest bg-white p-6 xl:col-span-2" onSubmit={(event) => { event.preventDefault(); run("/v1/inventory/parts", { ...partForm, kitTypeId: Number(partForm.kitTypeId), userGroupId: partForm.userGroupId ? Number(partForm.userGroupId) : undefined }, "Inventory part created."); }}><h3 className="font-semibold text-bt-purple-darker">Part Master</h3><div className="mt-4 grid gap-3 md:grid-cols-3"><Field label="Description"><input className={inputClass} required value={partForm.partDescription} onChange={(e) => setPartForm({ ...partForm, partDescription: e.target.value })} /></Field><Field label="Manufacturer Part Code"><input className={inputClass} value={partForm.manufacturerPartCode} onChange={(e) => setPartForm({ ...partForm, manufacturerPartCode: e.target.value })} /></Field><Field label="Kit Type"><select className={inputClass} required value={partForm.kitTypeId} onChange={(e) => setPartForm({ ...partForm, kitTypeId: e.target.value })}><option value="">Select type</option>{(meta.kitTypes || []).map((type) => <option key={type.id} value={type.id}>{type.code} · {type.name}</option>)}</select></Field><Field label="Manufacturer"><input className={inputClass} value={partForm.manufacturer} onChange={(e) => setPartForm({ ...partForm, manufacturer: e.target.value })} /></Field><Field label="Model"><input className={inputClass} value={partForm.model} onChange={(e) => setPartForm({ ...partForm, model: e.target.value })} /></Field><Field label="Tracking"><select className={inputClass} value={partForm.serialized ? "serialized" : "quantity"} onChange={(e) => setPartForm({ ...partForm, serialized: e.target.value === "serialized" })}><option value="serialized">Serialized</option><option value="quantity">Quantity</option></select></Field></div><button className={`${buttonPrimary} mt-4`} type="submit">Create Part</button></form>
          <form className="rounded-2xl border border-bt-purple-lightest bg-white p-6" onSubmit={(event) => { event.preventDefault(); run("/v1/inventory/locations", { ...locationForm, warehouseId: Number(locationForm.warehouseId) }, "Location saved."); }}><h3 className="font-semibold text-bt-purple-darker">Store Location</h3><div className="mt-4 space-y-3"><Field label="Warehouse"><select className={inputClass} required value={locationForm.warehouseId} onChange={(e) => setLocationForm({ ...locationForm, warehouseId: e.target.value })}><option value="">Select warehouse</option>{(meta.warehouses || []).map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></Field><Field label="Location Code"><input className={`${inputClass} font-mono`} required value={locationForm.locationCode} onChange={(e) => setLocationForm({ ...locationForm, locationCode: e.target.value.toUpperCase() })} placeholder="SHEF-01-A03-S04-B08" /></Field><Field label="Location Type"><select className={inputClass} value={locationForm.locationType} onChange={(e) => setLocationForm({ ...locationForm, locationType: e.target.value })}>{locationTypeOptions.map((type) => <option key={type}>{type}</option>)}</select></Field></div><button className={`${buttonPrimary} mt-4`} type="submit"><MapPin size={16} /> Save Location</button></form>
          <form className="rounded-2xl border border-bt-purple-lightest bg-white p-6" onSubmit={(event) => { event.preventDefault(); run("/v1/inventory/couriers", courierForm, "Courier saved."); }}><h3 className="font-semibold text-bt-purple-darker">Courier</h3><div className="mt-4 space-y-3"><Field label="Courier Name"><input className={inputClass} required value={courierForm.courierName} onChange={(e) => setCourierForm({ ...courierForm, courierName: e.target.value })} /></Field><Field label="Account Reference"><input className={inputClass} value={courierForm.accountReference} onChange={(e) => setCourierForm({ ...courierForm, accountReference: e.target.value })} /></Field><Field label="Tracking URL Template"><input className={inputClass} value={courierForm.trackingUrlTemplate} onChange={(e) => setCourierForm({ ...courierForm, trackingUrlTemplate: e.target.value })} /></Field></div><button className={`${buttonPrimary} mt-4`} type="submit">Save Courier</button></form>
        </div>
      ) : null}

      {!access.canManageStock && !access.isEngineering && !access.isManager ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><AlertTriangle className="mr-2 inline" size={16} />Your team currently has read-only inventory access.</div> : null}
    </div>
  );
}
