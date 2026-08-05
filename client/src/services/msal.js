import { PublicClientApplication } from "@azure/msal-browser";

const defaultRedirectUri =
  typeof window !== "undefined"
    ? window.location.origin
    : "https://localhost:5173";

const config = {
  auth: {
    clientId: import.meta.env.VITE_AZURE_CLIENT_ID || "your-azure-client-id",
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_TENANT_ID || "common"}`,
    redirectUri: import.meta.env.VITE_AZURE_REDIRECT_URI || defaultRedirectUri,
  },
  cache: {
    cacheLocation: "sessionStorage",
  },
};

export const msalInstance = new PublicClientApplication(config);

export const loginRequest = {
  scopes: ["User.Read"],
};
