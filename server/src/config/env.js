import dotenv from "dotenv";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const candidateEnvPaths = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(currentDir, "../../../.env"),
  path.resolve(currentDir, "../../.env"),
];

for (const candidatePath of candidateEnvPaths) {
  dotenv.config({ path: candidatePath, override: false });
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default(""),
  JWT_SECRET: z.string().min(16).default("development-secret-key"),
  AZURE_TENANT_ID: z.string().default(""),
  AZURE_CLIENT_ID: z.string().default(""),
  AZURE_CLIENT_SECRET: z.string().default(""),
  GRAPH_DRIVE_ID: z.string().default(""),
  GOOGLE_SHEET_ID: z.string().default(""),
  GOOGLE_API_KEY: z.string().default(""),
  GOOGLE_KEY_FILE_PATH: z.string().default(""),
  DEV_AUTH_BYPASS: z.string().default("false"),
  DEV_MEMORY_MODE: z.string().default("false"),
  DEV_AUTH_DEFAULT_USER_KEY: z.string().default("admin"),
  MYSQL_HOST: z.string().default("localhost"),
  MYSQL_PORT: z.coerce.number().default(3306),
  MYSQL_USER: z.string().default("root"),
  MYSQL_PASSWORD: z.string().default(""),
  MYSQL_DATABASE: z.string().default("project_billing_system"),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(5),
  FRONTEND_ORIGINS: z.string().default("https://localhost:5173"),
  TRUST_PROXY: z.coerce.number().int().nonnegative().default(1),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const configuredOrigins = parsed.data.FRONTEND_ORIGINS
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (parsed.data.NODE_ENV === "production") {
  const unsafeDefaults = [
    parsed.data.JWT_SECRET === "development-secret-key",
    parsed.data.DEV_AUTH_BYPASS === "true",
    parsed.data.DEV_MEMORY_MODE === "true",
    !parsed.data.MYSQL_HOST,
    !parsed.data.MYSQL_USER,
    !parsed.data.MYSQL_PASSWORD,
    !parsed.data.MYSQL_DATABASE,
    configuredOrigins.length === 0,
    configuredOrigins.some((origin) => /localhost|127\.0\.0\.1/i.test(origin)),
  ];

  if (unsafeDefaults.some(Boolean) || parsed.data.JWT_SECRET.length < 32) {
    console.error(
      "Invalid production environment: configure a strong JWT_SECRET, MySQL credentials, and non-local FRONTEND_ORIGINS; disable development modes.",
    );
    process.exit(1);
  }
}

export const env = {
  nodeEnv: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  databaseUrl: parsed.data.DATABASE_URL,
  jwtSecret: parsed.data.JWT_SECRET,
  azureTenantId: parsed.data.AZURE_TENANT_ID,
  azureClientId: parsed.data.AZURE_CLIENT_ID,
  azureClientSecret: parsed.data.AZURE_CLIENT_SECRET,
  graphDriveId: parsed.data.GRAPH_DRIVE_ID,
  googleSheetId: parsed.data.GOOGLE_SHEET_ID,
  googleApiKey: parsed.data.GOOGLE_API_KEY,
  googleKeyFilePath: parsed.data.GOOGLE_KEY_FILE_PATH,
  devAuthBypass: parsed.data.DEV_AUTH_BYPASS === "true",
  devMemoryMode: parsed.data.DEV_MEMORY_MODE === "true",
  devAuthDefaultUserKey: parsed.data.DEV_AUTH_DEFAULT_USER_KEY,
  mysqlHost: parsed.data.MYSQL_HOST,
  mysqlPort: parsed.data.MYSQL_PORT,
  mysqlUser: parsed.data.MYSQL_USER,
  mysqlPassword: parsed.data.MYSQL_PASSWORD,
  mysqlDatabase: parsed.data.MYSQL_DATABASE,
  sessionIdleTimeoutMinutes: parsed.data.SESSION_IDLE_TIMEOUT_MINUTES,
  frontendOrigins: configuredOrigins,
  trustProxy: parsed.data.TRUST_PROXY,
};
