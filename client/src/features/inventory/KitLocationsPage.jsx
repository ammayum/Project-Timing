import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, MapPin, Plus, RefreshCw, ScanLine, UserRound, Warehouse } from "lucide-react";
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

function LocationCard({ location, engineers, canAssign, onAssign, pending }) {
  const [employeeId, setEmployeeId] = useState(location.assigned_employee_id || "");

  return (
    <div className="rounded-2xl border border-bt-purple-lightest bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm font-semibold text-bt-purple-darker">{location.location_code}</p>
          <p className="mt-1 text-xs text-bt-grey-600">{location.description || location.location_type}</p>
        </div>
        <span className="rounded-full bg-bt-purple-lightest/50 px-2.5 py-1 text-xs font-semibold text-bt-purple-darker">
          {location.location_type}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2 text-sm text-black">
        <UserRound size={15} className="text-bt-purple" />
        {location.assigned_employee_name || "Unassigned Engineering location"}
        {location.assigned_employee_ein ? <span className="text-bt-grey-600">· EIN {location.assigned_employee_ein}</span> : null}
      </div>

      {canAssign && location.location_type === "ENGINEERING_CUSTODY" ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <select className={inputClass} value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
            <option value="">Unassigned / Engineering team</option>
            {engineers.map((engineer) => (
              <option key={engineer.id} value={engineer.id}>
                {engineer.name}{engineer.ein ? ` · EIN ${engineer.ein}` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={secondaryButton}
            disabled={pending}
            onClick={() => onAssign(location.id, employeeId ? Number(employeeId) : null)}
          >
            Assign
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function KitLocationsPage({ auth }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState(null);
  const [moveForm, setMoveForm] = useState({ identifier: "", toLocationId: "", reason: "Kit location movement", reference: "" });
  const [createForm, setCreateForm] = useState({ warehouseId: "", employeeId: "", locationCode: "", description: "", storeNumber: "", aisle: "", shelf: "", bin: "" });

  const metaQuery = useQuery({
    queryKey: ["inventory", "kit-locations", "meta"],
    queryFn: () => apiClient.get("/v1/inventory/location-moves/meta"),
  });

  const mutation = useMutation({
    mutationFn: ({ path, body }) => apiClient.post(path, body),
    onSuccess: async (_data, variables) => {
      setNotice({ tone: "success", text: variables.successMessage || "Updated successfully." });
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (error) => setNotice({ tone: "error", text: error.message || "Operation failed." }),
  });

  const meta = metaQuery.data || {};
  const access = meta.access || {};
  const locations = meta.locations || [];
  const engineeringUsers = meta.engineeringUsers || [];

  const engineeringLocations = useMemo(
    () => locations.filter((location) => location.location_type === "ENGINEERING_CUSTODY"),
    [locations],
  );
  const warehouses = useMemo(() => {
    const seen = new Map();
    for (const location of locations) {
      if (!seen.has(location.warehouse_id)) {
        seen.set(location.warehouse_id, {
          id: location.warehouse_id,
          code: location.warehouse_code,
          name: location.warehouse_name,
        });
      }
    }
    return [...seen.values()];
  }, [locations]);

  const moveDestinations = access.mode === "ENGINEERING"
    ? engineeringLocations.filter((location) => Number(location.assigned_employee_id) === Number(auth?.employee?.id))
    : locations;

  const submitMove = (event) => {
    event.preventDefault();
    mutation.mutate({
      path: "/v1/inventory/location-moves",
      body: {
        ...moveForm,
        toLocationId: Number(moveForm.toLocationId),
      },
      successMessage: access.mode === "ENGINEERING"
        ? "Kit moved to your Engineering location."
        : "Kit location and custody updated.",
    });
  };

  const createEngineeringLocation = (event) => {
    event.preventDefault();
    mutation.mutate({
      path: "/v1/inventory/engineering-locations",
      body: {
        ...createForm,
        warehouseId: Number(createForm.warehouseId),
        employeeId: Number(createForm.employeeId),
      },
      successMessage: "Engineering location created and assigned.",
    });
  };

  const assignLocation = (locationId, employeeId) => {
    mutation.mutate({
      path: `/v1/inventory/engineering-locations/${locationId}/assign`,
      body: { employeeId },
      successMessage: "Engineering location assignment updated.",
    });
  };

  if (metaQuery.isLoading) {
    return <section className="glass-panel rounded-[2rem] border border-white/10 p-8 text-white shadow-panel">Loading kit locations...</section>;
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
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-bt-purple-lightest">Kit Locations</p>
              <h2 className="mt-2 text-3xl font-semibold">
                {access.mode === "ENGINEERING" ? "Move kits to your Engineering location" : "Stores and Engineering location control"}
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-white/80">
                Stores can move kits directly into Engineering custody locations. Engineering users can move Engineering-custody kits only into locations assigned to themselves.
              </p>
            </div>
            <div className="rounded-2xl bg-white/10 px-4 py-3 text-sm">
              <p className="font-semibold">{auth?.employee?.name}</p>
              <p className="text-white/70">{access.mode} · {auth?.employee?.team_name || auth?.employee?.role}</p>
            </div>
          </div>
        </div>
      </section>

      {notice ? (
        <div className={`rounded-xl border px-4 py-3 text-sm ${notice.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          {notice.text}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <form className="rounded-2xl border border-bt-purple-lightest bg-white p-6 shadow-sm" onSubmit={submitMove}>
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-bt-purple-lightest/50 p-2 text-bt-purple"><ScanLine size={20} /></div>
            <div>
              <h3 className="text-lg font-semibold text-bt-purple-darker">Scan and move kit</h3>
              <p className="text-sm text-bt-grey-600">Use either the permanent serial number or the current project part code.</p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <Field label="Serial number or part code">
              <input autoFocus required className={`${inputClass} font-mono text-lg`} value={moveForm.identifier} onChange={(event) => setMoveForm({ ...moveForm, identifier: event.target.value })} placeholder="Scan kit..." />
            </Field>
            <Field label="Destination" hint={access.mode === "ENGINEERING" ? "Only locations assigned to your user are available." : "Engineering locations automatically transfer custody to Engineering."}>
              <select required className={inputClass} value={moveForm.toLocationId} onChange={(event) => setMoveForm({ ...moveForm, toLocationId: event.target.value })}>
                <option value="">Select destination</option>
                {moveDestinations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.location_code} · {location.location_type}{location.assigned_employee_name ? ` · ${location.assigned_employee_name}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reference"><input className={inputClass} value={moveForm.reference} onChange={(event) => setMoveForm({ ...moveForm, reference: event.target.value })} /></Field>
            <Field label="Reason"><textarea required className={inputClass} value={moveForm.reason} onChange={(event) => setMoveForm({ ...moveForm, reason: event.target.value })} /></Field>
          </div>

          <button className={`${primaryButton} mt-5`} disabled={mutation.isPending || !access.canMove} type="submit">
            <ArrowRightLeft size={17} /> Commit Kit Movement
          </button>
        </form>

        <section className="rounded-2xl border border-bt-purple-lightest bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-bt-purple-darker">{access.mode === "ENGINEERING" ? "My locations" : "Engineering locations"}</h3>
              <p className="mt-1 text-sm text-bt-grey-600">
                {access.mode === "ENGINEERING" ? "These are the only destinations you can move kits into." : "Assign each personal Engineering location to its Engineer."}
              </p>
            </div>
            <button type="button" className={secondaryButton} onClick={() => metaQuery.refetch()}><RefreshCw size={16} /></button>
          </div>
          <div className="mt-4 space-y-3">
            {engineeringLocations.length ? engineeringLocations.map((location) => (
              <LocationCard
                key={location.id}
                location={location}
                engineers={engineeringUsers}
                canAssign={access.canAssignEngineeringLocations}
                onAssign={assignLocation}
                pending={mutation.isPending}
              />
            )) : (
              <div className="rounded-xl border border-dashed border-bt-purple-lightest p-6 text-center text-sm text-bt-grey-600">
                {access.mode === "ENGINEERING" ? "No Engineering location is assigned to you yet. Ask Stores to assign one." : "No Engineering custody locations exist yet."}
              </div>
            )}
          </div>
        </section>
      </div>

      {access.canAssignEngineeringLocations ? (
        <form className="rounded-2xl border border-bt-purple-lightest bg-white p-6 shadow-sm" onSubmit={createEngineeringLocation}>
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-bt-purple-lightest/50 p-2 text-bt-purple"><Plus size={20} /></div>
            <div>
              <h3 className="text-lg font-semibold text-bt-purple-darker">Create Engineer-owned location</h3>
              <p className="text-sm text-bt-grey-600">Stores creates the physical location and assigns it to an Engineering employee.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Field label="Warehouse"><select required className={inputClass} value={createForm.warehouseId} onChange={(event) => setCreateForm({ ...createForm, warehouseId: event.target.value })}><option value="">Select warehouse</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></Field>
            <Field label="Engineer"><select required className={inputClass} value={createForm.employeeId} onChange={(event) => setCreateForm({ ...createForm, employeeId: event.target.value })}><option value="">Select Engineer</option>{engineeringUsers.map((engineer) => <option key={engineer.id} value={engineer.id}>{engineer.name}{engineer.ein ? ` · EIN ${engineer.ein}` : ""}</option>)}</select></Field>
            <Field label="Location code"><input required className={`${inputClass} font-mono`} value={createForm.locationCode} onChange={(event) => setCreateForm({ ...createForm, locationCode: event.target.value.toUpperCase() })} placeholder="SHEF-ENG-AMMAYU" /></Field>
            <Field label="Description"><input className={inputClass} value={createForm.description} onChange={(event) => setCreateForm({ ...createForm, description: event.target.value })} /></Field>
            <Field label="Store number"><input className={inputClass} value={createForm.storeNumber} onChange={(event) => setCreateForm({ ...createForm, storeNumber: event.target.value })} /></Field>
            <Field label="Aisle"><input className={inputClass} value={createForm.aisle} onChange={(event) => setCreateForm({ ...createForm, aisle: event.target.value })} /></Field>
            <Field label="Shelf"><input className={inputClass} value={createForm.shelf} onChange={(event) => setCreateForm({ ...createForm, shelf: event.target.value })} /></Field>
            <Field label="Bin"><input className={inputClass} value={createForm.bin} onChange={(event) => setCreateForm({ ...createForm, bin: event.target.value })} /></Field>
          </div>
          <button className={`${primaryButton} mt-5`} disabled={mutation.isPending} type="submit"><MapPin size={17} /> Create & Assign Location</button>
        </form>
      ) : null}

      <section className="rounded-2xl border border-bt-purple-lightest bg-bt-grey-50 p-5 text-sm text-bt-grey-600">
        <div className="flex items-start gap-3">
          <Warehouse size={18} className="mt-0.5 text-bt-purple" />
          <p><strong className="text-bt-purple-darker">Custody rule:</strong> a Stores move into an <code>ENGINEERING_CUSTODY</code> location changes custody to Engineering and status to <code>WITH_ENGINEERING</code>. Engineering-to-Stores returns still use the formal return workflow.</p>
        </div>
      </section>
    </div>
  );
}
