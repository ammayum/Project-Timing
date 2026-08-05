import { chromium } from "playwright";

const baseUrl = "https://localhost:5173";
const adminCredentials = {
  username: process.env.SMOKE_ADMIN_USERNAME,
  password: process.env.SMOKE_ADMIN_PASSWORD,
};
const employeeCredentials = {
  username: process.env.SMOKE_EMPLOYEE_USERNAME,
  password: process.env.SMOKE_EMPLOYEE_PASSWORD,
};
const smokeUserSeed = Date.now();
const smokeUser = {
  username: `smoke.user.${smokeUserSeed}`,
  name: `Smoke User ${smokeUserSeed}`,
  email: `smoke.user.${smokeUserSeed}@example.com`,
  ein: `SMK${String(smokeUserSeed).slice(-6)}`,
};
const entryDate = "2026-07-22";
const orderNumber = `SMOKE-${smokeUserSeed}`;

function log(step, detail) {
  console.log(`[${step}] ${detail}`);
}

async function login(page, credentials) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Username or email").fill(credentials.username);
  await page.getByPlaceholder("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Login" }).click();
}

async function waitForBanner(page, text) {
  await page.locator("text=" + text).first().waitFor({ state: "visible", timeout: 20000 });
}

async function getFirstTeamOption(selectLocator) {
  const options = await selectLocator.locator("option").evaluateAll((nodes) =>
    nodes.map((node) => ({ value: node.value, label: node.textContent?.trim() ?? "" })),
  );
  return options.find((option) => option.value);
}

async function run() {
  if (Object.values({ ...adminCredentials, ...employeeCredentials }).some((value) => !value)) {
    throw new Error("Set SMOKE_ADMIN_USERNAME, SMOKE_ADMIN_PASSWORD, SMOKE_EMPLOYEE_USERNAME, and SMOKE_EMPLOYEE_PASSWORD before running smoke E2E.");
  }

  const browser = await chromium.launch({
    channel: "msedge",
    headless: true,
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  try {
    log("admin-login", "Signing in as admin");
    await login(page, adminCredentials);
    await page.getByRole("button", { name: "Admin" }).waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("heading", { name: "Users, Teams, Projects, and Access Control" }).waitFor({
      state: "visible",
      timeout: 20000,
    });

    log("admin-users", "Opening users tab");
    await page.getByRole("button", { name: "Users" }).click();
    await page.getByRole("heading", { name: "Create User" }).waitFor({ state: "visible", timeout: 10000 });

    const teamSelect = page.locator('section:has-text("Create User") select').nth(1);
    const initialTeam = await getFirstTeamOption(teamSelect);
    if (!initialTeam) {
      throw new Error("No team options are available for the smoke user.");
    }

    log("admin-create", `Creating ${smokeUser.email}`);
    await page.getByPlaceholder("SSO ID / Username").fill(smokeUser.username);
    await page.getByPlaceholder("Full Name").fill(smokeUser.name);
    await page.getByPlaceholder("Email Address").fill(smokeUser.email);
    await page.getByPlaceholder("EIN").fill(smokeUser.ein);
    await page.locator('section:has-text("Create User") select').first().selectOption("employee");
    await teamSelect.selectOption(initialTeam.value);
    await page.getByRole("button", { name: "Save User Account" }).click();
    await waitForBanner(page, "User saved successfully.");
    await page.getByText("Temporary Password", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
    const generatedPassword = (await page.locator("text=Generated Password").locator("..").textContent()) ?? "";
    if (!generatedPassword.includes("Generated Password")) {
      throw new Error("Temporary password modal did not render generated password content.");
    }
    await page.getByRole("button", { name: "Copy Password" }).click();
    await page.getByRole("button", { name: "Copied" }).waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: "Close" }).click();

    const userRow = page.locator("tr", { hasText: smokeUser.email });
    await userRow.waitFor({ state: "visible", timeout: 10000 });
    await userRow.getByText("Pending change").waitFor({ state: "visible", timeout: 10000 });

    const rowTeamSelect = userRow.locator("select");
    const rowOptions = await rowTeamSelect.locator("option").evaluateAll((nodes) =>
      nodes.map((node) => ({ value: node.value, label: node.textContent?.trim() ?? "" })),
    );
    const nextTeam = rowOptions.find((option) => option.value && option.value !== initialTeam.value) ?? rowOptions[0];
    if (nextTeam?.value && nextTeam.value !== initialTeam.value) {
      log("admin-update", `Changing ${smokeUser.email} to team ${nextTeam.label}`);
      await rowTeamSelect.selectOption(nextTeam.value);
      await waitForBanner(page, "User updated successfully.");
    } else {
      log("admin-update", "Only one team available, skipping team reassignment");
    }

    log("admin-reset", `Resetting password for ${smokeUser.email}`);
    await userRow.getByRole("button", { name: "Reset Password" }).click();
    await waitForBanner(page, `Password reset for ${smokeUser.name}.`);
    await page.getByText("Temporary Password", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: /Copy Password|Copied/ }).waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("button", { name: "Close" }).click();

    log("employee-login", "Signing in as employee");
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name: "Login" }).waitFor({ state: "visible", timeout: 20000 });
    await login(page, employeeCredentials);
    await page.getByRole("heading", { name: "Time Entry Workspace" }).waitFor({
      state: "visible",
      timeout: 20000,
    });

    const projectSelect = page.locator("tbody tr").first().locator("select").nth(1);
    const projectOptions = await projectSelect.locator("option").evaluateAll((nodes) =>
      nodes.map((node) => ({ value: node.value, label: node.textContent?.trim() ?? "" })),
    );
    const projectOption = projectOptions.find((option) => option.value);
    if (!projectOption) {
      throw new Error("No assignable projects are available for the employee smoke test.");
    }
    const projectCode = projectOption.value;

    log("timesheet-entry", `Submitting one row for project ${projectCode}`);
    await page.locator('input[type="date"]').fill(entryDate);
    await projectSelect.selectOption(projectCode);
    await page.getByPlaceholder("order number").fill(orderNumber);
    await page.locator('input[type="time"]').nth(0).fill("08:00");
    await page.locator('input[type="time"]').nth(1).fill("09:00");
    await page.getByRole("button", { name: "Submit" }).click();
    await waitForBanner(page, "Entries saved");

    log("csv-upload", "Opening CSV validation modal");
    await page.getByRole("button", { name: "Upload CSV" }).click();
    await page.getByRole("heading", { name: "Upload CSV" }).waitFor({ state: "visible", timeout: 10000 });
    await page.locator("textarea").fill(
      `date,activity,project,from_time,to_time,overtime,kits\n${entryDate},Project,${projectCode},09:00,10:00,false,SR123 PC456`,
    );
    await page.getByRole("button", { name: "Validate CSV" }).click();
    await waitForBanner(page, "CSV validated successfully.");

    log("complete", "Smoke pass finished successfully");
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
