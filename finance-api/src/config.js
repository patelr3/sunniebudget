const config = {
  port: Number(process.env.PORT) || 8080,
  subscriptionId: process.env.AZURE_SUBSCRIPTION_ID || "",
  financeRg: process.env.AZURE_FINANCE_RG || "patelr3-finance-rg",
  financeCae: process.env.AZURE_FINANCE_CAE || "finance-cae",
  financeStorage: process.env.AZURE_FINANCE_STORAGE || "patelr3financedata",
  acrServer: process.env.AZURE_ACR_SERVER || "patelr3acr.azurecr.io",
  siteRg: process.env.AZURE_SITE_RG || "patelr3-site-rg",
  location: "westus2",
  // Shared secret between auth-api and finance-api for request validation
  apiKey: process.env.FINANCE_API_KEY || "dev-finance-key",
};

export default config;
