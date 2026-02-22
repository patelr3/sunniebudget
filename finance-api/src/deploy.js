// Per-user Actual Budget ACA management via Azure Managed Identity
import { DefaultAzureCredential } from "@azure/identity";
import { ContainerAppsAPIClient } from "@azure/arm-appcontainers";
import { StorageManagementClient } from "@azure/arm-storage";
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

function appName(userId) { return `ab-user-${userId}`; }
function shareName(userId) { return `actual-user-${userId}`; }
function linkName(userId) { return `actualuser${userId}`; }

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
    const { aca } = clients();
    const app = await aca.containerApps.get(RG, appName(userId));
    const prov = app.provisioningState?.toLowerCase() || "";
    const fqdn = app.configuration?.ingress?.fqdn || "";

    let status = "running";
    if (prov === "failed") status = "error";
    else if (["inprogress", "waiting", "updating"].includes(prov)) status = "provisioning";

    return { status, fqdn: fqdn ? `https://${fqdn}` : "", provisioningState: prov };
  } catch (err) {
    if (err.statusCode === 404 || err.code === "ResourceNotFound") {
      return { status: "not_created" };
    }
    console.error(`[deploy] getStatus(${userId}):`, err.message);
    return { status: "error", message: err.message };
  }
}

export async function create(userId) {
  const { aca, storage } = clients();
  const share = shareName(userId);
  const link = linkName(userId);
  const name = appName(userId);
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
    tags: { project: "finance", userId: String(userId), managedBy: "finance-api" },
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
  const name = appName(userId);

  const existing = await aca.containerApps.get(RG, name);
  existing.template.containers[0].image = `${ACR}/actualbudget:latest`;
  await aca.containerApps.beginCreateOrUpdateAndWait(RG, name, existing);

  const fqdn = existing.configuration?.ingress?.fqdn || "";
  return { status: "running", fqdn: fqdn ? `https://${fqdn}` : "" };
}

export async function remove(userId) {
  const { aca } = clients();
  const name = appName(userId);
  const link = linkName(userId);

  try { await aca.containerApps.beginDeleteAndWait(RG, name); }
  catch (e) { if (e.statusCode !== 404) throw e; }

  try { await aca.managedEnvironmentsStorages.delete(RG, CAE, link); }
  catch (e) { if (e.statusCode !== 404) throw e; }

  // File share preserved for backup/recovery
  return { status: "deleted" };
}
