import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../services/api.js";
import { StatusBanner } from "../components/StatusBanner.jsx";

const adminTabs = [
  { key: "overview", label: "Overview" },
  { key: "users", label: "Users" },
  { key: "teams", label: "Teams" },
  { key: "projects", label: "Projects" },
  { key: "kits", label: "Kits" },
  { key: "database", label: "Database" },
];

function CheckboxList({ items, selectedIds, onToggle, emptyLabel }) {
  if (!items.length) {
    return <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-400">{emptyLabel}</div>;
  }

  return (
    <div className="grid gap-2 md:grid-cols-2">
      {items.map((item, index) => {
        const checked = selectedIds.includes(item.id);
        return (
          <label
            key={`${item.id ?? "item"}-${item.name ?? ""}-${index}`}
            className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white"
          >
            <input type="checkbox" checked={checked} onChange={() => onToggle(item.id)} />
            <span>{item.name}</span>
          </label>
        );
      })}
    </div>
  );
}

function PasswordStatusBadge({ mustChangePassword }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
        mustChangePassword
          ? "bg-bt-purple-lightest/50 text-bt-purple-dark"
          : "bg-bt-purple/10 text-bt-purple"
      }`}
    >
      {mustChangePassword ? "Pending change" : "Changed"}
    </span>
  );
}

export function AdminPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");
  const [status, setStatus] = useState({ message: "", tone: "info" });
  const [expandedProjects, setExpandedProjects] = useState({});
  const [passwordModal, setPasswordModal] = useState({
    open: false,
    userLabel: "",
    password: "",
    copied: false,
  });

  const [teamForm, setTeamForm] = useState({
    id: "",
    name: "",
    description: "",
  });

  const [userForm, setUserForm] = useState({
    sso_id: "",
    name: "",
    email: "",
    ein: "",
    role: "employee",
    team_id: "",
    overtime_allowed: false,
    working_hours_per_day: 7.5,
  });

  const [projectForm, setProjectForm] = useState({
    id: "",
    ja_code: "",
    project_name: "",
    fd_ref: "",
    suffix: "",
    status: "active",
    team_ids: [],
    manager_ids: [],
  });

  const [kitForm, setKitForm] = useState({
    id: "",
    project_ja_code: "",
    part_code: "",
    serial_number: "",
    device_type: "",
    brand: "",
    model: "",
  });

  const [kitCsvContent, setKitCsvContent] = useState(
    "project_ja_code,part_code,serial_number,device_type,brand,model\nJA001,PC700,SR700,Tester,Fluke,OneTouch\n"
  );

  const adminQuery = useQuery({
    queryKey: ["admin-data"],
    queryFn: () => apiClient.get("/admin"),
  });

  const dbQuery = useQuery({
    queryKey: ["admin-db"],
    queryFn: () => apiClient.get("/admin/db"),
  });

  const runtimeQuery = useQuery({
    queryKey: ["admin-runtime"],
    queryFn: () => apiClient.get("/admin/database-runtime"),
    retry: false,
  });

  const mysqlQuery = useQuery({
    queryKey: ["admin-mysql"],
    queryFn: () => apiClient.get("/admin/mysql"),
    retry: false,
  });

  const postgresQuery = useQuery({
    queryKey: ["admin-postgres"],
    queryFn: () => apiClient.get("/admin/postgres"),
    retry: false,
  });

  const employees = adminQuery.data?.employees || [];
  const teams = adminQuery.data?.teams || [];
  const managers = adminQuery.data?.managers || [];
  const projects = adminQuery.data?.projects || [];
  const projectsWithKits = adminQuery.data?.projectsWithKits || [];
  const kits = adminQuery.data?.kits || [];

  const roleOptions = useMemo(
    () => [
      { value: "employee", label: "Employee" },
      { value: "manager", label: "Manager" },
      { value: "admin", label: "Admin" },
    ],
    []
  );

  const refreshAdmin = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-data"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-db"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-runtime"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-mysql"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-postgres"] }),
      queryClient.invalidateQueries({ queryKey: ["time-entry-meta"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-meta"] }),
      queryClient.invalidateQueries({ queryKey: ["projects-with-kits"] }),
    ]);
  };

  const runAction = async (action, successMessage) => {
    try {
      const result = await action();
      await refreshAdmin();
      setStatus({
        message: typeof successMessage === "function" ? successMessage(result) : successMessage,
        tone: "success",
      });
      return result;
    } catch (error) {
      setStatus({ message: error.message, tone: "error" });
      return null;
    }
  };

  const showPasswordModal = (userLabel, password) => {
    setPasswordModal({
      open: true,
      userLabel,
      password,
      copied: false,
    });
  };

  const closePasswordModal = () => {
    setPasswordModal({
      open: false,
      userLabel: "",
      password: "",
      copied: false,
    });
  };

  const copyTemporaryPassword = async () => {
    try {
      await navigator.clipboard.writeText(passwordModal.password);
      setPasswordModal((current) => ({ ...current, copied: true }));
    } catch (error) {
      setStatus({
        message: "Clipboard copy failed. Please copy the temporary password manually before closing this window.",
        tone: "error",
      });
    }
  };

  const toggleSelection = (stateKey, id) => {
    setProjectForm((current) => ({
      ...current,
      [stateKey]: current[stateKey].includes(id)
        ? current[stateKey].filter((value) => value !== id)
        : [...current[stateKey], id],
    }));
  };

  const loadProjectIntoForm = (project) => {
    const projectCode = project.ja_code ?? project.Ja_Code ?? "";
    const projectName = project.project_name ?? project.Project_Name ?? "";
    const projectFdRef = project.fd_ref ?? project.FD_Ref ?? "";
    const projectSuffix = project.suffix ?? project.Suffix ?? "";
    const projectStatus = String(project.status || "active").toLowerCase();

    setProjectForm({
      id: String(project.id),
      ja_code: projectCode,
      project_name: projectName,
      fd_ref: projectFdRef,
      suffix: projectSuffix,
      status: projectStatus === "inactive" ? "inactive" : "active",
      team_ids: (project.teams || []).map((team) => team.id),
      manager_ids: (project.managers || []).map((manager) => manager.id),
    });
    setActiveTab("projects");
  };

  const saveTeam = async () =>
    runAction(
      () =>
        apiClient.post("/admin/teams", {
          id: teamForm.id ? Number(teamForm.id) : undefined,
          name: teamForm.name,
          description: teamForm.description,
        }),
      "Team saved successfully."
    );

  const saveUser = async () => {
    const result = await runAction(
      () =>
        apiClient.post("/admin/users", {
          ...userForm,
          team_id: userForm.team_id ? Number(userForm.team_id) : null,
          is_admin: userForm.role === "admin",
          set_default_password: true,
        }),
      "User saved successfully."
    );

    if (result?.temporaryPassword) {
      showPasswordModal(result.user?.name || userForm.name || userForm.email || userForm.sso_id || "New user", result.temporaryPassword);
    }
  };

  const updateEmployee = async (employee, overrides = {}) => {
    const role = overrides.role ?? employee.role ?? (employee.is_admin ? "admin" : "employee");

    await runAction(
      () =>
        apiClient.put(`/admin/employees/${employee.id}`, {
          name: overrides.name ?? employee.name,
          email: overrides.email ?? employee.email,
          ein: overrides.ein ?? employee.ein ?? "",
          role,
          overtime_allowed: overrides.overtime_allowed ?? employee.overtime_allowed,
          working_hours_per_day: overrides.working_hours_per_day ?? employee.working_hours_per_day ?? 7.5,
          is_admin: role === "admin",
          team_id:
            overrides.team_id !== undefined
              ? overrides.team_id
              : employee.team_id ?? null,
        }),
      "User updated successfully."
    );
  };

  const resetUserPassword = async (employee) => {
    const result = await runAction(
      () => apiClient.post(`/admin/users/${employee.id}/reset-password`, {}),
      `Password reset for ${employee.name}.`
    );

    if (result?.temporaryPassword) {
      showPasswordModal(employee.name, result.temporaryPassword);
    }
  };

  const saveProject = async () =>
    runAction(
      () =>
        apiClient.post("/admin/projects", {
          id: projectForm.id ? Number(projectForm.id) : undefined,
          ja_code: projectForm.ja_code,
          project_name: projectForm.project_name,
          fd_ref: projectForm.fd_ref,
          suffix: projectForm.suffix,
          status: projectForm.status,
          team_ids: projectForm.team_ids,
          manager_ids: projectForm.manager_ids,
        }),
      "Project and assignments saved successfully."
    );

  const saveKit = async () =>
    runAction(
      () =>
        apiClient.post("/admin/kits", {
          ...kitForm,
          id: kitForm.id ? Number(kitForm.id) : undefined,
          project_ja_code: kitForm.project_ja_code || null,
        }),
      "Kit saved successfully."
    );

  const importKitCsv = async () =>
    runAction(
      () => apiClient.post("/admin/kits/upload", { csvContent: kitCsvContent }),
      "Kit CSV imported successfully."
    );

  const initializeMysql = async () =>
    runAction(() => apiClient.post("/admin/mysql/init", {}), "MySQL database initialized.");

  const initializePostgres = async () =>
    runAction(() => apiClient.post("/admin/postgres/init", {}), "PostgreSQL database initialized.");

  const switchRuntimeMode = async (mode) =>
    runAction(
      () => apiClient.post("/admin/database-runtime/mode", { mode, note: `Switched to ${mode}` }),
      `Database runtime mode changed to ${mode}.`
    );

  const setEngineEnabled = async (engine, enabled) =>
    runAction(
      () => apiClient.post(`/admin/database-runtime/engines/${engine}`, { enabled, note: `${enabled ? "Enabled" : "Disabled"} ${engine}` }),
      `${engine === "mysql" ? "MySQL" : "PostgreSQL"} ${enabled ? "enabled" : "disabled"}.`
    );

  const toggleProject = (projectId) => {
    setExpandedProjects((current) => ({
      ...current,
      [projectId]: !current[projectId],
    }));
  };

  if (adminQuery.isLoading) {
    return <div className="glass-panel rounded-[2rem] border border-white/10 p-6">Loading admin data...</div>;
  }

  return (
    <div className="space-y-6">
      <StatusBanner message={status.message} tone={status.tone} />

      <section className="glass-panel rounded-[2rem] border border-white/10 p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Admin Workspace</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Users, Teams, Projects, and Access Control</h2>
        <p className="mt-2 text-sm text-slate-300">
          Assign employees to teams, connect projects to teams, and link multiple managers to multiple projects.
        </p>
      </section>

      <section className="glass-panel rounded-[2rem] border border-white/10 p-3 shadow-panel">
        <div className="flex flex-wrap gap-2">
          {adminTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                activeTab === tab.key ? "bg-white text-ink" : "text-slate-300 hover:bg-white/5"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "overview" && (
        <section className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <div className="glass-panel rounded-2xl border border-white/10 p-5 shadow-panel">
            <h3 className="text-sm font-medium text-slate-400">Employees</h3>
            <p className="mt-2 text-3xl font-semibold text-white">{employees.length}</p>
          </div>
          <div className="glass-panel rounded-2xl border border-white/10 p-5 shadow-panel">
            <h3 className="text-sm font-medium text-slate-400">Teams</h3>
            <p className="mt-2 text-3xl font-semibold text-white">{teams.length}</p>
          </div>
          <div className="glass-panel rounded-2xl border border-white/10 p-5 shadow-panel">
            <h3 className="text-sm font-medium text-slate-400">Projects</h3>
            <p className="mt-2 text-3xl font-semibold text-white">{projects.length}</p>
          </div>
          <div className="glass-panel rounded-2xl border border-white/10 p-5 shadow-panel">
            <h3 className="text-sm font-medium text-slate-400">Managers</h3>
            <p className="mt-2 text-3xl font-semibold text-white">{managers.length}</p>
          </div>
        </section>
      )}

      {activeTab === "users" && (
        <div className="space-y-6">
          <section className="glass-panel rounded-2xl border border-white/10 p-6 shadow-panel">
            <h3 className="mb-4 text-lg font-semibold text-white">Create User</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <input
                type="text"
                placeholder="SSO ID / Username"
                value={userForm.sso_id}
                onChange={(e) => setUserForm({ ...userForm, sso_id: e.target.value })}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white"
              />
              <input
                type="text"
                placeholder="Full Name"
                value={userForm.name}
                onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white"
              />
              <input
                type="email"
                placeholder="Email Address"
                value={userForm.email}
                onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white"
              />
              <input
                type="text"
                placeholder="EIN"
                value={userForm.ein}
                onChange={(e) => setUserForm({ ...userForm, ein: e.target.value })}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white"
              />
              <input
                type="number"
                min="0.25"
                max="24"
                step="0.25"
                placeholder="Daily working hours"
                value={userForm.working_hours_per_day}
                onChange={(e) => setUserForm({ ...userForm, working_hours_per_day: e.target.value })}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white"
              />
                            <input
                type="text"
                placeholder="Working Time"
                value={userForm.work_time}
                onChange={(e) => setUserForm({ ...userForm, work_time: e.target.value })}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white"
              />
              <select
                value={userForm.role}
                onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white"
              >
                {roleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                value={userForm.team_id}
                onChange={(e) => setUserForm({ ...userForm, team_id: e.target.value })}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white"
              >
                <option value="">No team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>

            <label className="mt-4 flex items-center gap-3 text-sm text-white">
              <input
                type="checkbox"
                checked={userForm.overtime_allowed}
                onChange={(e) => setUserForm({ ...userForm, overtime_allowed: e.target.checked })}
              />
              Overtime allowed
            </label>

            <p className="mt-4 text-sm text-slate-300">
              New users receive an auto-generated temporary password and must change it on first login.
            </p>

            <button
              type="button"
              onClick={saveUser}
              className="mt-4 rounded-xl bg-aqua px-5 py-2.5 text-sm font-semibold text-white"
            >
              Save User Account
            </button>
          </section>

          <section className="glass-panel overflow-x-auto rounded-2xl border border-white/10 p-6 shadow-panel">
            <h3 className="mb-4 text-lg font-semibold text-white">Employees</h3>
            <table className="min-w-full text-left text-sm text-slate-300">
              <thead>
                <tr className="border-b border-white/10 text-slate-400">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Password</th>
                  <th className="px-3 py-2">Daily hours</th>
                  <th className="px-3 py-2">Team</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {employees.map((employee) => (
                  <tr key={employee.id}>
                    <td className="px-3 py-3 text-white">{employee.name}</td>
                    <td className="px-3 py-3">{employee.email}</td>
                    <td className="px-3 py-3 capitalize">{employee.role}</td>
                    <td className="px-3 py-3">
                      <PasswordStatusBadge mustChangePassword={Boolean(employee.must_change_password)} />
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="number"
                        min="0.25"
                        max="24"
                        step="0.25"
                        defaultValue={employee.working_hours_per_day ?? 7.5}
                        onBlur={(event) => {
                          const value = Number(event.target.value);
                          if (value >= 0.25 && value <= 24) {
                            updateEmployee(employee, { working_hours_per_day: value });
                          }
                        }}
                        className="w-24 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <select
                        value={employee.team_id ?? ""}
                        onChange={(e) =>
                          updateEmployee(employee, {
                            team_id: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white"
                      >
                        <option value="">No team</option>
                        {teams.map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            updateEmployee(employee, {
                              role: employee.role === "admin" ? "employee" : "admin",
                            })
                          }
                          className="rounded-lg bg-white/10 px-3 py-1 text-xs text-white"
                        >
                          Toggle Admin
                        </button>
                        <button
                          type="button"
                          onClick={() => resetUserPassword(employee)}
                          className="rounded-lg bg-aqua/15 px-3 py-1 text-xs text-aqua"
                        >
                          Reset Password
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {activeTab === "teams" && (
        <div className="space-y-6">
          <section className="glass-panel rounded-2xl border border-white/10 p-6 shadow-panel">
            <h3 className="mb-4 text-lg font-semibold text-white">Create Team</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <input
                type="text"
                placeholder="Team Name"
                value={teamForm.name}
                onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white"
              />
              <input
                type="text"
                placeholder="Description"
                value={teamForm.description}
                onChange={(e) => setTeamForm({ ...teamForm, description: e.target.value })}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white"
              />
            </div>
            <button type="button" onClick={saveTeam} className="mt-4 rounded-xl bg-aqua px-5 py-2.5 text-sm font-semibold text-white">
              Save Team
            </button>
          </section>

          <section className="glass-panel rounded-2xl border border-white/10 p-6 shadow-panel">
            <h3 className="mb-4 text-lg font-semibold text-white">Teams</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {teams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => setTeamForm({ id: String(team.id), name: team.name, description: team.description || "" })}
                  className="rounded-xl border border-white/10 bg-white/5 p-4 text-left"
                >
                  <p className="font-semibold text-white">{team.name}</p>
                  <p className="mt-1 text-sm text-slate-400">{team.description || "No description"}</p>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {activeTab === "projects" && (
        <div className="space-y-6">
          <section className="glass-panel rounded-2xl border border-white/10 p-6 shadow-panel">
            <h3 className="mb-4 text-lg font-semibold text-white">Project Setup</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <input
                type="text"
                placeholder="JA Code"
                value={projectForm.ja_code}
                onChange={(e) => setProjectForm({ ...projectForm, ja_code: e.target.value })}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white"
              />
              <input
                type="text"
                placeholder="Project Name"
                value={projectForm.project_name}
                onChange={(e) => setProjectForm({ ...projectForm, project_name: e.target.value })}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white"
              />
              <input
                type="text"
                placeholder="FD Ref"
                value={projectForm.fd_ref}
                onChange={(e) => setProjectForm({ ...projectForm, fd_ref: e.target.value })}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white"
              />
              <input
                type="text"
                placeholder="Suffix"
                value={projectForm.suffix}
                onChange={(e) => setProjectForm({ ...projectForm, suffix: e.target.value })}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white"
              />
              <select
                value={projectForm.status}
                onChange={(e) => setProjectForm({ ...projectForm, status: e.target.value })}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div>
                <h4 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Assigned Teams</h4>
                <CheckboxList
                  items={teams}
                  selectedIds={projectForm.team_ids}
                  onToggle={(id) => toggleSelection("team_ids", id)}
                  emptyLabel="No teams created yet."
                />
              </div>
              <div>
                <h4 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Assigned Managers</h4>
                <CheckboxList
                  items={managers}
                  selectedIds={projectForm.manager_ids}
                  onToggle={(id) => toggleSelection("manager_ids", id)}
                  emptyLabel="No managers available yet."
                />
              </div>
            </div>

            <button type="button" onClick={saveProject} className="mt-6 rounded-xl bg-aqua px-5 py-2.5 text-sm font-semibold text-white">
              Save Project
            </button>
          </section>

          <section className="glass-panel rounded-2xl border border-white/10 p-6 shadow-panel">
            <h3 className="mb-4 text-lg font-semibold text-white">Projects and Assignments</h3>
            <div className="space-y-3">
              {projectsWithKits.map((project) => {
                const projectCode = project.ja_code ?? project.Ja_Code ?? "";
                const projectName = project.project_name ?? project.Project_Name ?? "";
                const projectId = project.id;
                const expanded = expandedProjects[projectId];
                return (
                  <div key={projectId} className="overflow-hidden rounded-xl border border-white/10">
                    <button
                      type="button"
                      onClick={() => toggleProject(projectId)}
                      className="flex w-full items-center justify-between bg-white/5 px-5 py-4 text-left"
                    >
                      <div>
                        <p className="font-semibold text-white">
                          {projectCode} · {projectName}
                        </p>
                        <p className="mt-1 text-sm text-slate-400">
                          Teams: {(project.teams || []).map((team) => team.name).join(", ") || "None"}
                        </p>
                        <p className="mt-1 text-sm text-slate-400">
                          Managers: {(project.managers || []).map((manager) => manager.name).join(", ") || "None"}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            loadProjectIntoForm(project);
                          }}
                          className="rounded-lg bg-aqua/15 px-3 py-1 text-xs text-aqua"
                        >
                          Edit
                        </button>
                        <span className="rounded-lg bg-white/10 px-3 py-1 text-xs text-slate-300">
                          {(project.kits || []).length} Kits
                        </span>
                      </div>
                    </button>

                    {expanded && (
                      <div className="border-t border-white/10 p-4">
                        {(project.kits || []).length === 0 ? (
                          <p className="text-sm text-slate-400">No kits assigned yet.</p>
                        ) : (
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {project.kits.map((kit, index) => (
                              <div key={`${projectId}-${kit.id ?? "kit"}-${kit.serial_number || ""}-${kit.part_code || ""}-${index}`} className="rounded-xl bg-white/5 p-4">
                                <p className="font-semibold text-white">{kit.serial_number || kit.part_code || "-"}</p>
                                <p className="text-sm text-slate-400">{kit.device_type || "-"} · {kit.brand || "-"} {kit.model || ""}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {activeTab === "kits" && (
        <div className="space-y-6">
          <section className="glass-panel rounded-2xl border border-white/10 p-6 shadow-panel">
            <h3 className="mb-4 text-lg font-semibold text-white">Add Kit</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <input className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white" placeholder="Project JA Code" value={kitForm.project_ja_code} onChange={(e) => setKitForm({ ...kitForm, project_ja_code: e.target.value })} />
              <input className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white" placeholder="Part Code" value={kitForm.part_code} onChange={(e) => setKitForm({ ...kitForm, part_code: e.target.value })} />
              <input className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white" placeholder="Serial Number" value={kitForm.serial_number} onChange={(e) => setKitForm({ ...kitForm, serial_number: e.target.value })} />
              <input className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white" placeholder="Device Type" value={kitForm.device_type} onChange={(e) => setKitForm({ ...kitForm, device_type: e.target.value })} />
              <input className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white" placeholder="Brand" value={kitForm.brand} onChange={(e) => setKitForm({ ...kitForm, brand: e.target.value })} />
              <input className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white" placeholder="Model" value={kitForm.model} onChange={(e) => setKitForm({ ...kitForm, model: e.target.value })} />
            </div>
            <button type="button" onClick={saveKit} className="mt-4 rounded-xl bg-aqua px-5 py-2.5 text-sm font-semibold text-white">
              Save Kit
            </button>
          </section>

          <section className="glass-panel rounded-2xl border border-white/10 p-6 shadow-panel">
            <h3 className="text-lg font-semibold text-white">Bulk CSV Import</h3>
            <p className="mt-2 text-sm text-slate-300">
              Required columns: <span className="text-white">project_ja_code, part_code, serial_number, device_type, brand, model</span>
            </p>
            <textarea
              value={kitCsvContent}
              onChange={(e) => setKitCsvContent(e.target.value)}
              className="mt-4 h-40 w-full rounded-xl border border-white/10 bg-slate-950/60 p-3 text-xs text-bt-purple-dark"
            />
            <button type="button" onClick={importKitCsv} className="mt-4 rounded-xl bg-flare px-5 py-2.5 font-semibold text-white">
              Import CSV
            </button>
          </section>

          <section className="glass-panel rounded-2xl border border-white/10 p-6 shadow-panel">
            <h3 className="mb-4 text-lg font-semibold text-white">Kit Inventory ({kits.length})</h3>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {kits.map((kit, index) => (
                <div key={`${kit.id ?? "kit"}-${kit.serial_number || ""}-${kit.part_code || ""}-${kit.project_ja_code || ""}-${index}`} className="rounded-xl bg-white/5 p-4">
                  <p className="font-semibold text-white">{kit.serial_number || kit.part_code || "-"}</p>
                  <p className="text-sm text-slate-400">{kit.device_type || "-"} · {kit.brand || "-"} {kit.model || ""}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {activeTab === "database" && (
        <section className="space-y-6">
          <div className="glass-panel rounded-2xl border border-white/10 p-6">
            <h3 className="text-lg font-semibold text-white">Runtime Mode</h3>
            <p className="mt-3 text-slate-300">
              Selected mode:
              <span className="ml-2 text-aqua">{runtimeQuery.data?.mode || dbQuery.data?.mode || "checking"}</span>
            </p>
            <p className="mt-2 text-slate-300">
              Primary database:
              <span className="ml-2 text-white">{runtimeQuery.data?.primaryDb || dbQuery.data?.primaryDb || "-"}</span>
            </p>
            <p className="mt-2 text-slate-300">
              Writes:
              <span className="ml-2 text-white">{runtimeQuery.data?.writeEnabled ? "enabled" : "blocked"}</span>
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {["mysql_primary", "postgres_primary", "mysql_only", "postgres_only", "maintenance"].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => switchRuntimeMode(mode)}
                  className="rounded-lg bg-white/10 px-3 py-2 text-xs text-white"
                >
                  {mode}
                </button>
              ))}
            </div>
            <p className="mt-4 text-xs text-slate-400">
              The current normal flow stays on MySQL until an admin explicitly switches mode here.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="glass-panel rounded-2xl border border-white/10 p-6">
              <h3 className="text-lg font-semibold text-white">MySQL</h3>
              <p className="mt-3 text-slate-300">
                Connected: <span className="ml-2 text-aqua">{mysqlQuery.data?.connected ? "yes" : "no"}</span>
              </p>
              <p className="mt-2 text-slate-300">
                Database: <span className="ml-2 text-white">{mysqlQuery.data?.database || "-"}</span>
              </p>
              <p className="mt-2 text-slate-300">
                Enabled for runtime:
                <span className="ml-2 text-white">{runtimeQuery.data?.mysqlEnabled ? "yes" : "no"}</span>
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" onClick={initializeMysql} className="rounded-xl bg-flare px-5 py-2 font-semibold text-white">
                  Initialize MySQL
                </button>
                <button type="button" onClick={() => setEngineEnabled("mysql", true)} className="rounded-xl bg-aqua px-5 py-2 font-semibold text-white">
                  Start MySQL
                </button>
                <button type="button" onClick={() => setEngineEnabled("mysql", false)} className="rounded-xl bg-white/10 px-5 py-2 font-semibold text-white">
                  Stop MySQL
                </button>
              </div>
            </div>

            <div className="glass-panel rounded-2xl border border-white/10 p-6">
              <h3 className="text-lg font-semibold text-white">PostgreSQL</h3>
              <p className="mt-3 text-slate-300">
                Connected: <span className="ml-2 text-aqua">{postgresQuery.data?.connected ? "yes" : "no"}</span>
              </p>
              <p className="mt-2 text-slate-300">
                Database: <span className="ml-2 text-white">{postgresQuery.data?.database || "-"}</span>
              </p>
              <p className="mt-2 text-slate-300">
                Enabled for runtime:
                <span className="ml-2 text-white">{runtimeQuery.data?.postgresEnabled ? "yes" : "no"}</span>
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" onClick={initializePostgres} className="rounded-xl bg-flare px-5 py-2 font-semibold text-white">
                  Initialize PostgreSQL
                </button>
                <button type="button" onClick={() => setEngineEnabled("postgres", true)} className="rounded-xl bg-aqua px-5 py-2 font-semibold text-white">
                  Start PostgreSQL
                </button>
                <button type="button" onClick={() => setEngineEnabled("postgres", false)} className="rounded-xl bg-white/10 px-5 py-2 font-semibold text-white">
                  Stop PostgreSQL
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="glass-panel rounded-2xl border border-white/10 p-6">
              <h3 className="text-lg font-semibold text-white">Database Status</h3>
              <p className="mt-3 text-slate-300">
                Read engine: <span className="ml-2 text-aqua">{runtimeQuery.data?.primaryDb || dbQuery.data?.primaryDb || "checking"}</span>
              </p>
              <p className="mt-2 text-slate-300">
                Database: <span className="ml-2 text-white">{dbQuery.data?.databaseName || "-"}</span>
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Replication and automatic failover are still intentionally manual in this version.
              </p>
            </div>

            <div className="glass-panel rounded-2xl border border-white/10 p-6">
              <h3 className="text-lg font-semibold text-white">Table Statistics</h3>
              <div className="mt-4 space-y-2">
                {(dbQuery.data?.tables || []).map((table) => (
                  <div key={table.name} className="flex justify-between rounded-lg bg-white/5 p-3">
                    <span className="text-slate-300">{table.name}</span>
                    <span className="font-semibold text-white">{table.rows}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {passwordModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4">
          <div className="w-full max-w-lg rounded-[2rem] border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Temporary Password</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">{passwordModal.userLabel}</h3>
            <p className="mt-3 text-sm text-slate-300">
              This password is shown only in this window. Copy it now and share it securely with the user.
            </p>
            <div className="mt-5 rounded-2xl border border-aqua/20 bg-slate-950/80 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Generated Password</p>
              <div className="mt-2 break-all font-mono text-lg text-aqua">{passwordModal.password}</div>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={copyTemporaryPassword}
                disabled={passwordModal.copied}
                className={`rounded-xl px-5 py-2.5 text-sm font-semibold ${
                  passwordModal.copied ? "bg-bt-purple-lightest text-bt-purple-dark" : "bg-aqua text-white"
                }`}
              >
                {passwordModal.copied ? "Copied" : "Copy Password"}
              </button>
              <button
                type="button"
                onClick={closePasswordModal}
                className="rounded-xl border border-white/10 px-5 py-2.5 text-sm font-semibold text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
