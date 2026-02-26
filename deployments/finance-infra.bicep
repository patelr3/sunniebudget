// Shared finance infrastructure — CAE, storage account, blob container, finance-api
// Per-user resources (file shares, storage links, ACAs) created by finance-api at runtime
targetScope = 'resourceGroup'

@description('Azure region')
param location string = 'westus2'

@description('Docker image tag for finance-api')
param financeApiTag string = 'latest'

var tags = {
  project: 'finance'
  managedBy: 'bicep'
}

// AKV in patelr3-site-rg holds the finance-api-key secret
var kvName = 'patelr3kvl3ytczhajsp7i'
var kvSecretsUrl = 'https://${kvName}${environment().suffixes.keyvaultDns}/secrets'

// ── Existing UAMI for AKV access (in patelr3-site-rg) ──────────
resource kvReaderIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: 'patelr3-kv-reader'
  scope: resourceGroup('patelr3-site-rg')
}

// ── Existing ACR (in patelr3-site-rg) ──────────────────────────
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: 'patelr3acr'
  scope: resourceGroup('patelr3-site-rg')
}

// ── Container Apps Environment ─────────────────────────────────
resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'finance-cae'
  location: location
  tags: tags
  properties: {
    workloadProfiles: [
      { name: 'Consumption', workloadProfileType: 'Consumption' }
    ]
  }
}

// ── Storage Account for user data + backups ────────────────────
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'patelr3financedata'
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource backupContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'backups'
}

// ── Finance API (middleman for per-user ACA management) ────────
resource financeApi 'Microsoft.App/containerApps@2024-10-02-preview' = {
  name: 'finance-api'
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned,UserAssigned'
    userAssignedIdentities: {
      '${kvReaderIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: acr.properties.loginServer
          username: acr.listCredentials().username
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        { name: 'acr-password', value: acr.listCredentials().passwords[0].value }
        { name: 'finance-api-key', keyVaultUrl: '${kvSecretsUrl}/finance-api-key', identity: kvReaderIdentity.id }
      ]
    }
    template: {
      containers: [
        {
          name: 'finance-api'
          image: '${acr.properties.loginServer}/finance-api:${financeApiTag}'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'AZURE_SUBSCRIPTION_ID', value: subscription().subscriptionId }
            { name: 'AZURE_FINANCE_RG', value: resourceGroup().name }
            { name: 'AZURE_FINANCE_CAE', value: cae.name }
            { name: 'AZURE_FINANCE_STORAGE', value: storage.name }
            { name: 'AZURE_ACR_SERVER', value: acr.properties.loginServer }
            { name: 'AZURE_SITE_RG', value: 'patelr3-site-rg' }
            { name: 'FINANCE_API_KEY', secretRef: 'finance-api-key' }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
        cooldownPeriod: 3600
      }
    }
  }
}

// ── Outputs ────────────────────────────────────────────────────
output caeName string = cae.name
output caeId string = cae.id
output caeDefaultDomain string = cae.properties.defaultDomain
output storageAccountName string = storage.name
output financeApiFqdn string = financeApi.properties.configuration.ingress.fqdn
output financeApiPrincipalId string = financeApi.identity.principalId
