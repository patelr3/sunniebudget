// Actual Budget ACA deployment — uses existing patelr3 infrastructure
targetScope = 'resourceGroup'

@description('Azure region')
param location string = 'westus2'

@description('Docker image tag')
param imageTag string = 'latest'

var tags = {
  project: 'actualbudget'
  managedBy: 'bicep'
}

// ── Existing resources (from patelr3-site) ─────────────────────
var acrName = 'patelr3acr'
var envName = 'patelr3-cae'

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}

resource cae 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: envName
}

// ── Storage Account for persistent data + backups ──────────────
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'patelr3actualdata'
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

// File share for live data (mounted into ACA)
resource dataShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileService
  name: 'actual-data'
  properties: {
    shareQuota: 5
  }
}

// Blob container for monthly backups
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource backupContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'backups'
}

// ── Link storage to CAE ────────────────────────────────────────
resource caeStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: cae
  name: 'actualdata'
  properties: {
    azureFile: {
      accountName: storage.name
      accountKey: storage.listKeys().keys[0].value
      shareName: dataShare.name
      accessMode: 'ReadWrite'
    }
  }
}

// ── Actual Budget Container App ────────────────────────────────
resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'patelr3-actualbudget'
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 5006
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
        {
          name: 'acr-password'
          value: acr.listCredentials().passwords[0].value
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'actualbudget'
          image: '${acr.properties.loginServer}/actualbudget:${imageTag}'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          volumeMounts: [
            {
              volumeName: 'data'
              mountPath: '/data'
            }
            {
              volumeName: 'persistent'
              mountPath: '/persistent'
            }
          ]
        }
      ]
      volumes: [
        {
          name: 'data'
          storageType: 'EmptyDir'
        }
        {
          name: 'persistent'
          storageName: caeStorage.name
          storageType: 'AzureFile'
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

output fqdn string = app.properties.configuration.ingress.fqdn
output storageAccountName string = storage.name
