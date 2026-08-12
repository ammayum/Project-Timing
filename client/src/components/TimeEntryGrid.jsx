import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import Select from "react-select";
import { calculateHours, validateRowOverlap } from "../lib/time.js";

const activities = ["Project", "Admin", "Education", "Meeting"];

const projectSelectStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: "42px",
     width: "300px",
    borderRadius: "1rem",
    borderColor: "#D9D9D9",
    backgroundColor: "#F5F5F5",
    boxShadow: "none",
    opacity: state.isDisabled ? 0.5 : 1,
    "&:hover": {
      borderColor: "#5514B4",
    },

    
  }),
  valueContainer: (base) => ({
    ...base,
    padding: "0 0.75rem",
  }),
  input: (base) => ({
    ...base,
    color: "#000000",
    margin: 0,
    padding: 0,
  }),
  singleValue: (base) => ({
    ...base,
    color: "#000000",
  }),
  placeholder: (base) => ({
    ...base,
    color: "#737373",
  }),
  menu: (base) => ({
    ...base,
    zIndex: 60,
    borderRadius: "1rem",
    overflow: "hidden",
    border: "1px solid #D9D9D9",
    backgroundColor: "#FFFFFF",
  }),
  menuList: (base) => ({
    ...base,
    padding: "0.35rem",
  }),
  option: (base, state) => ({
    ...base,
    borderRadius: "0.75rem",
    backgroundColor: state.isSelected ? "#5514B4" : state.isFocused ? "#CBB8E7" : "#FFFFFF",
    color: state.isSelected ? "#FFFFFF" : "#000000",
    cursor: "pointer",
  }),
  clearIndicator: (base) => ({
    ...base,
    color: "#737373",
    "&:hover": {
      color: "#5514B4",
    },
  }),
  dropdownIndicator: (base) => ({
    ...base,
    color: "#737373",
    "&:hover": {
      color: "#5514B4",
    },
  }),
  indicatorSeparator: () => ({
    display: "none",
  }),
};

function createBlankRow(date) {
  return {
    date,
    activity: "Project",
    project: "",
    order_num: "",
    from_time: "",
    to_time: "",
    overtime: false,
    kits: "",
  };
}

export function TimeEntryGrid({
  date,
  rows,
  setRows,
  projects = [],
  totalHours,
  maxWorkingHours = 7.5,
  overtimeExceeded,
  inlineError,
}) {
  const overlapIndexes = useMemo(() => validateRowOverlap(rows), [rows]);
  const projectOptions = useMemo(
    () =>
      projects.map((project, index) => {
        const projectCode = project.ja_code ?? project.Ja_Code ?? "";
        const projectName = project.project_name ?? project.Project_Name ?? "";
        const projectId = project.id ?? `project-${index}`;
        const projectSuffix = project.suffix ?? project.Suffix ?? "";

        return {
          value: projectCode,
          label: `${projectCode} - ${projectName}`,
          optionKey: `${projectId}-${projectCode}-${projectSuffix}-${index}`,
        };
      }),
    [projects],
  );

  const updateRow = (index, field, value) => {
    setRows((currentRows) =>
      currentRows.map((row, rowIndex) => {
        if (rowIndex !== index) {
          return row;
        }

        const nextRow = { ...row, [field]: value };
        if (field === "activity" && value !== "Project") {
          nextRow.project = "";
        }

        return nextRow;
      }),
    );
  };

  return (
    <section className="glass-panel rounded-[2rem] border border-white/10 p-5 shadow-panel">
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-y-3 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-[0.25em] text-slate-400">
              <th className="px-3">Activity</th>
              <th className="px-3">Project</th>
              <th className="px-3">Order num</th>
              <th className="px-3">Kits</th>
              <th className="px-3">O/T</th>
              <th className="px-3">From</th>
              <th className="px-3">To</th>
              <th className="px-3">Hours</th>
              <th className="px-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const hours = calculateHours(row.from_time, row.to_time);
              const rowHasError =
                overlapIndexes.has(index) ||
                (row.activity === "Project" && !row.project) ||
                (hours === 0 && row.from_time && row.to_time);

              return (
                <tr key={`${date}-${index}`} className="rounded-3xl bg-white/[0.04]">
                  <td className="px-3 py-3">
                    <select
                      value={row.activity}
                      onChange={(event) => updateRow(index, "activity", event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-3 py-2"
                    >
                      {activities.map((activity) => (
                        <option key={activity} value={activity}>
                          {activity}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="px-3 py-3">
                    <Select
                      isDisabled={row.activity !== "Project"}
                      isClearable
                      isSearchable
                      placeholder="Search / Select project"
                      value={projectOptions.find((option) => option.value === row.project) || null}
                      options={projectOptions}
                      getOptionValue={(option) => option.optionKey}
                      onChange={(option) => updateRow(index, "project", option?.value || "")}
                      styles={projectSelectStyles}
                      className="w-full"
                      menuPortalTarget={typeof document !== "undefined" ? document.body : null}
                      menuPosition="fixed"
                      menuPlacement="auto"
                      unstyled={false}
                    />
                  </td>

                  <td className="px-3 py-3">
                    <input
                      type="text"
                      value={row.order_num}
                      onChange={(event) => updateRow(index, "order_num", event.target.value)}
                      placeholder="order number"
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-3 py-2"
                    />
                  </td>

                  <td className="px-3 py-3">
                    <input
                      type="text"
                      value={row.kits}
                      onChange={(event) => updateRow(index, "kits", event.target.value)}
                      placeholder="SR123 PC456"
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-3 py-2"
                    />
                  </td>

                  <td className="px-3 py-3">
                    <label className="flex items-center justify-center">
                      <input
                        type="checkbox"
                        checked={row.overtime}
                        onChange={(event) => updateRow(index, "overtime", event.target.checked)}
                        className="h-5 w-5 rounded border-white/20 bg-slate-950/50"
                      />
                    </label>
                  </td>

                  <td className="px-3 py-3">
                    <input
                      type="time"
                      value={row.from_time}
                      onChange={(event) => updateRow(index, "from_time", event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-3 py-2"
                    />
                  </td>

                  <td className="px-3 py-3">
                    <input
                      type="time"
                      value={row.to_time}
                      onChange={(event) => updateRow(index, "to_time", event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-3 py-2"
                    />
                  </td>

                  <td className="px-3 py-3">
                    <div className={`rounded-2xl px-3 py-2 ${rowHasError ? "bg-coral/15 text-coral" : "bg-white/5"}`}>
                      {hours || "0.00"}
                    </div>
                  </td>

                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                      className="rounded-full bg-white/5 p-2 text-coral"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <button
          type="button"
          onClick={() => setRows((current) => [...current, createBlankRow(date)])}
          className="inline-flex items-center gap-2 rounded-2xl bg-white/5 px-4 py-2 text-sm"
        >
          <Plus size={16} />
          Add Row
        </button>

        <div className="text-right">
          <p className={`text-lg font-semibold ${overtimeExceeded ? "text-coral" : "text-aqua"}`}>
            Total: {totalHours.toFixed(2)} / {maxWorkingHours}
          </p>
          {inlineError && <p className="mt-1 text-sm text-coral">{inlineError}</p>}
        </div>
      </div>
    </section>
  );
}

export function createInitialRow(date) {
  return createBlankRow(date);
}
