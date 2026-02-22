// Per-user Actual Budget ACA management via Azure Managed Identity
import { DefaultAzureCredential } from "@azure/identity";
import { ContainerAppsAPIClient } from "@azure/arm-appcontainers";
import { StorageManagementClient } from "@azure/arm-storage";
import crypto from "node:crypto";
import config from "./config.js";

const {
  subscriptionId: SUB, financeRg: RG, financeCae: CAE,
  financeStorage: STORAGE, acrServer: ACR, siteRg: SITE_RG, location: LOC,
} = config;
const ACR_NAME = ACR.split(".")[0];

let _clients = null;
function clients() {
  if (!_clients) {
    const cred = new DefaultAzureCredential();
    _clients = {
      cred,
      aca: new ContainerAppsAPIClient(cred, SUB),
      storage: new StorageManagementClient(cred, SUB),
    };
  }
  return _clients;
}

// Sanitize username for Azure resource names (lowercase alphanumeric only)
// ACA name limit: 32 chars. Format: ab-{user}-{hash} → 3 + user + 1 + 4 = user ≤ 24
// Storage link limit: 32 chars. Format: actual{user}{hash} → 6 + user + 4 = user ≤ 22
// Cap at 20 for safety margin.
function sanitizeUsername(username) {
  return (username || "user").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20) || "user";
}

// Deterministic 4-char hex hash from userId
function userHash(userId) {
  return crypto.createHash("sha256").update(String(userId)).digest("hex").slice(0, 4);
}

function appName(username, userId) { return `ab-${sanitizeUsername(username)}-${userHash(userId)}`; }
function shareName(username, userId) { return `actual-${sanitizeUsername(username)}-${userHash(userId)}`; }
function linkName(username, userId) { return `actual${sanitizeUsername(username)}${userHash(userId)}`; }

// Find a user's ACA by userId tag (handles old and new naming schemes)
async function findAppByUserId(userId) {
  const { aca } = clients();
  for await (const app of aca.containerApps.listByResourceGroup(RG)) {
    if (app.tags?.userId === String(userId) && app.tags?.managedBy === "finance-api") {
      return app;
    }
  }
  return null;
}

async function getAcrPassword() {
  const { cred } = clients();
  const token = await cred.getToken("https://management.azure.com/.default");
  const url = `https://management.azure.com/subscriptions/${SUB}/resourceGroups/${SITE_RG}/providers/Microsoft.ContainerRegistry/registries/${ACR_NAME}/listCredentials?api-version=2023-07-01`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token.token}` },
  });
  if (!res.ok) throw new Error(`ACR listCredentials: ${res.status}`);
  const data = await res.json();
  return { username: data.username, password: data.passwords[0].value };
}

export async function getStatus(userId) {
  try {
    const app = await findAppByUserId(userId);
    if (!app) return { status: "not_created" };

    const prov = app.provisioningState?.toLowerCase() || "";
    const fqdn = app.configuration?.ingress?.fqdn || "";

    let status = "running";
    if (prov === "failed") status = "error";
    else if (["inprogress", "waiting", "updating"].includes(prov)) status = "provisioning";

    return { status, fqdn: fqdn ? `https://${fqdn}` : "", provisioningState: prov, appName: app.name };
  } catch (err) {
    console.error(`[deploy] getStatus(${userId}):`, err.message);
    return { status: "error", message: err.message };
  }
}

const MAX_USER_INSTANCES = 10;

export async function create(userId, username) {
  const { aca, storage } = clients();

  // Enforce instance limit
  let count = 0;
  for await (const app of aca.containerApps.listByResourceGroup(RG)) {
    if (app.tags?.managedBy === "finance-api") count++;
  }
  if (count >= MAX_USER_INSTANCES) {
    throw new Error(`Instance limit reached (${MAX_USER_INSTANCES}). Please contact the site owner.`);
  }

  const share = shareName(username, userId);
  const link = linkName(username, userId);
  const name = appName(username, userId);
  const caeId = `/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.App/managedEnvironments/${CAE}`;

  // 1. File share
  await storage.fileShares.create(RG, STORAGE, share, { shareQuota: 5 });

  // 2. Storage key + CAE storage link
  const keys = await storage.storageAccounts.listKeys(RG, STORAGE);
  const key = keys.keys[0].value;
  await aca.managedEnvironmentsStorages.createOrUpdate(RG, CAE, link, {
    properties: { azureFile: { accountName: STORAGE, accountKey: key, shareName: share, accessMode: "ReadWrite" } },
  });

  // 3. ACR credentials
  const acr = await getAcrPassword();

  // 4. Create container app
  const app = await aca.containerApps.beginCreateOrUpdateAndWait(RG, name, {
    location: LOC,
    tags: { project: "finance", userId: String(userId), username: sanitizeUsername(username), managedBy: "finance-api" },
    managedEnvironmentId: caeId,
    configuration: {
      activeRevisionsMode: "Single",
      ingress: { external: true, targetPort: 5006, transport: "auto", allowInsecure: false },
      registries: [{ server: ACR, username: acr.username, passwordSecretRef: "acr-password" }],
      secrets: [{ name: "acr-password", value: acr.password }],
    },
    template: {
      terminationGracePeriodSeconds: 90,
      containers: [{
        name: "actualbudget",
        image: `${ACR}/actualbudget:latest`,
        resources: { cpu: 0.25, memory: "0.5Gi" },
        volumeMounts: [
          { volumeName: "data", mountPath: "/data" },
          { volumeName: "persistent", mountPath: "/persistent" },
        ],
      }],
      volumes: [
        { name: "data", storageType: "EmptyDir" },
        { name: "persistent", storageName: link, storageType: "AzureFile" },
      ],
      scale: { minReplicas: 0, maxReplicas: 1 },
    },
  });

  const fqdn = app.configuration?.ingress?.fqdn || "";
  return { status: "running", fqdn: fqdn ? `https://${fqdn}` : "" };
}

export async function update(userId) {
  const { aca } = clients();
  const app = await findAppByUserId(userId);
  if (!app) throw new Error("Deployment not found");
  const name = app.name;

  app.template.containers[0].image = `${ACR}/actualbudget:latest`;
  await aca.containerApps.beginCreateOrUpdateAndWait(RG, name, app);

  const fqdn = app.configuration?.ingress?.fqdn || "";
  return { status: "running", fqdn: fqdn ? `https://${fqdn}` : "" };
}

export async function remove(userId) {
  const { aca } = clients();
  const app = await findAppByUserId(userId);
  if (!app) return { status: "deleted" };

  const name = app.name;
  // Derive the link name from the share tag or app name
  const linkSuffix = name.replace(/^ab-/, "actual");

  try { await aca.containerApps.beginDeleteAndWait(RG, name); }
  catch (e) { if (e.statusCode !== 404) throw e; }

  try { await aca.managedEnvironmentsStorages.delete(RG, CAE, linkSuffix); }
  catch (e) { if (e.statusCode !== 404) throw e; }

  // File share preserved for backup/recovery
  return { status: "deleted" };
}
