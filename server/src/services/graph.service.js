import { Client } from "@microsoft/microsoft-graph-client";
import { ClientSecretCredential } from "@azure/identity";
import { google } from "googleapis";
import { env } from "../config/env.js";
import { AppError } from "../lib/app-error.js";

function hasGraphConfig() {
  return Boolean(env.azureTenantId && env.azureClientId && env.azureClientSecret && env.graphDriveId);
}

function hasGoogleSheetsConfig() {
  return Boolean(env.googleSheetId && (env.googleKeyFilePath || env.googleApiKey));
}

function createGraphClient() {
  if (!env.azureTenantId || !env.azureClientId || !env.azureClientSecret) {
    throw new AppError(500, "Microsoft Graph credentials are not configured");
  }

  const credential = new ClientSecretCredential(env.azureTenantId, env.azureClientId, env.azureClientSecret);
  return Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const token = await credential.getToken("https://graph.microsoft.com/.default");
        return token.token;
      },
    },
  });
}

function createSheetsClient() {
  if (env.googleKeyFilePath) {
    return google.sheets({
      version: 'v4',
      auth: new google.auth.GoogleAuth({
        keyFile: env.googleKeyFilePath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      }),
    });
  } else if (env.googleApiKey) {
    return google.sheets({ version: 'v4', auth: env.googleApiKey });
  } else {
    throw new AppError(500, "Google Sheets credentials are not configured");
  }
}

export const graphService = {
  getProvider() {
    if (hasGoogleSheetsConfig()) {
      return "google-sheets";
    }
    if (hasGraphConfig()) {
      return "sharepoint";
    }
    return "unconfigured";
  },

  async appendRows(rows) {
    if (hasGoogleSheetsConfig()) {
      const sheets = createSheetsClient();
      const values = rows.map((row) => [
        row.date,
        row.employee,
        row.ein,
        row.activity,
        row.project,
        row.from,
        row.to,
        row.hours,
        row.kits,
      ]);

      await sheets.spreadsheets.values.append({
        spreadsheetId: env.googleSheetId,
        range: 'TimeEntries!A:I',
        valueInputOption: 'RAW',
        resource: { values },
      });

      return { mode: "google-sheets", rowsAppended: rows.length };
    }

    throw new AppError(400, "No sync provider configured (Google Sheets or SharePoint)");
  },

  async readWorkbookRows() {
    if (hasGoogleSheetsConfig()) {
      const sheets = createSheetsClient();
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: env.googleSheetId,
        range: 'TimeEntries!A:I',
      });

      const values = response.data.values || [];
      return values.slice(1).map((row) => ({
        date: row[0],
        employee: row[1],
        employee_email: row[1],
        ein: row[2],
        activity: row[3],
        project: row[4],
        from: row[5],
        to: row[6],
        hours: row[7],
        kits: row[8],
      }));
    }

    return []; // No provider configured
  },

  async listFiles() {
    if (hasGoogleSheetsConfig()) {
      const sheets = createSheetsClient();
      const response = await sheets.spreadsheets.get({
        spreadsheetId: env.googleSheetId,
        fields: "spreadsheetId,spreadsheetUrl,properties.title,sheets.properties.title",
      });

      const tabNames = (response.data.sheets || [])
        .map((item) => item.properties?.title)
        .filter(Boolean);

      return [{
        id: response.data.spreadsheetId,
        name: response.data.properties?.title || "Linked Google Sheet",
        webUrl: response.data.spreadsheetUrl,
        lastModifiedDateTime: null,
        size: null,
        provider: "google-sheets",
        content: tabNames.length ? `Tabs: ${tabNames.join(", ")}` : "",
      }];
    }

    if (hasGraphConfig()) {
      const client = createGraphClient();
      const response = await client.api(`/drives/${env.graphDriveId}/root/children`).get();
      return (response.value || []).map((item) => ({
        id: item.id,
        name: item.name,
        webUrl: item.webUrl,
        lastModifiedDateTime: item.lastModifiedDateTime,
        size: item.size,
      }));
    }

    return [];
  },

  async createFile({ name, content }) {
    if (hasGoogleSheetsConfig()) {
      throw new AppError(400, "Google Sheets is linked. Edit directly in Google Sheets.");
    }

    if (hasGraphConfig()) {
      const client = createGraphClient();
      const response = await client.api(`/drives/${env.graphDriveId}/root:/${name}:/content`).put(content || "");
      return {
        id: response.id,
        name: response.name,
        webUrl: response.webUrl,
        lastModifiedDateTime: response.lastModifiedDateTime,
        size: response.size,
      };
    }

    throw new AppError(400, "No file storage provider configured");
  },

  async updateFile({ itemId, name, content }) {
    if (hasGoogleSheetsConfig()) {
      throw new AppError(400, "Google Sheets is linked. Update directly in Google Sheets.");
    }

    if (hasGraphConfig()) {
      const client = createGraphClient();
      if (name) {
        await client.api(`/drives/${env.graphDriveId}/items/${itemId}`).patch({ name });
      }
      if (content !== undefined) {
        await client.api(`/drives/${env.graphDriveId}/items/${itemId}/content`).put(content);
      }
      const item = await client.api(`/drives/${env.graphDriveId}/items/${itemId}`).get();
      return {
        id: item.id,
        name: item.name,
        webUrl: item.webUrl,
        lastModifiedDateTime: item.lastModifiedDateTime,
        size: item.size,
      };
    }

    throw new AppError(400, "No file storage provider configured");
  },

  async readProjects() {
    if (hasGoogleSheetsConfig()) {
      const sheets = createSheetsClient();
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: env.googleSheetId,
        range: 'Projects!A:D',
      });

      const values = response.data.values || [];
      return values.slice(1).map((row) => ({
        ja_code: row[0],
        project_name: row[1],
        suffix: row[2] || "",
        status: row[3] || "active",
      }));
    }
    return [];
  },

  async readKits() {
    if (hasGoogleSheetsConfig()) {
      const sheets = createSheetsClient();
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: env.googleSheetId,
        range: 'Kits!A:F',
      });

      const values = response.data.values || [];
      return values.slice(1).map((row) => ({
        project_ja_code: row[0],
        part_code: row[1],
        serial_number: row[2] || "",
        device_type: row[3] || "",
        brand: row[4] || "",
        model: row[5] || "",
      }));
    }
    return [];
  },
};