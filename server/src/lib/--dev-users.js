export const devUsers = [
  {
    key: "admin",
    ssoId: "dev-admin-user",
    name: "Ava Admin",
    email: "admin.e2e@example.com",
    ein: "ADM001",
    role: "admin",
    isAdmin: true,
    overtimeAllowed: true,
    roleLabel: "Administrator",
  },
  {
    key: "manager",
    ssoId: "dev-manager-user",
    name: "Mason Manager",
    email: "manager.e2e@example.com",
    ein: "MGR002",
    role: "manager",
    isAdmin: false,
    overtimeAllowed: true,
    roleLabel: "Project Manager",
  },
  {
    key: "engineer",
    ssoId: "dev-engineer-user",
    name: "Ella Engineer",
    email: "engineer.e2e@example.com",
    ein: "ENG003",
    role: "employee",
    isAdmin: false,
    overtimeAllowed: false,
    roleLabel: "Engineer",
  },
];

export function findDevUserByKey(key) {
  return devUsers.find((user) => user.key === key) ?? null;
}
