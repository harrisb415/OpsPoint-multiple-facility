// OpsPoint on Azure (profile azure): one facility on Container Apps, with Azure Database for
// PostgreSQL (reached only inside its virtual network), Blob Storage for photos and Key Vault for
// the secrets. See docs/CLOUD.md.
//
//   az deployment group create -g <resource group> -f packaging/cloud/azure/main.bicep \
//     -p name=sunrise timeZone=America/Los_Angeles
//
// The release turns this into azuredeploy.json for the Deploy to Azure button. Deploying it again
// (a new image, a new size) keeps the database, the photos and every secret.

@description('A short name for this facility\'s resources: lowercase letters, digits and dashes, 2 to 12 characters (for example sunrise).')
@minLength(2)
@maxLength(12)
param name string

@description('The facility\'s time zone, as an IANA name such as America/Los_Angeles or America/Chicago. Dates are filed by it.')
param timeZone string

@description('small: one facility up to about 50 residents. medium: a busy facility. multi-facility: several facilities\' worth of staff on one app.')
@allowed(['small', 'medium', 'multi-facility'])
param size string = 'small'

@description('Optional: an address push services can reach you at about this install\'s alerts. Blank: the app\'s own address.')
param contactEmail string = ''

@description('The OpsPoint image. Each release\'s button pins its own version.')
param image string = 'ghcr.io/harrisb415/opspoint:latest'

@description('Where the resources go. Defaults to the resource group\'s region.')
param location string = resourceGroup().location

@description('Leave as it is: makes the secrets script check the vault at every deployment.')
param deployedAt string = utcNow()

var sizes = {
  small: { cpu: '0.5', memory: '1Gi', dbSku: 'Standard_B1ms', dbTier: 'Burstable', dbGB: 32, backupDays: 7 }
  medium: { cpu: '1.0', memory: '2Gi', dbSku: 'Standard_B2s', dbTier: 'Burstable', dbGB: 64, backupDays: 14 }
  'multi-facility': { cpu: '2.0', memory: '4Gi', dbSku: 'Standard_D2ds_v5', dbTier: 'GeneralPurpose', dbGB: 128, backupDays: 35 }
}
var s = sizes[size]
var tags = { app: 'opspoint', facility: name }
// Globally unique names (vault, storage, database) end in a suffix fixed by the resource group.
var suffix = take(uniqueString(resourceGroup().id, name), 6)
var appName = 'opspoint-${name}'
var vaultName = 'kv-${name}-${suffix}'
var storageName = 'st${replace(name, '-', '')}${suffix}'
var dbServerName = '${name}-db-${suffix}'
var dbUser = 'opspoint'
var dbName = 'opspoint'
var photosContainer = 'opspoint'

// Built-in roles.
var keyVaultSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6'
var keyVaultSecretsOfficer = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
var storageBlobDataContributor = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

// ── Network: the app's subnet and the database's ──────────────────────────────────────────────
resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${name}-vnet'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.40.0.0/16'] }
    subnets: [
      {
        name: 'apps'
        properties: {
          addressPrefix: '10.40.0.0/23'
          delegations: [{ name: 'apps', properties: { serviceName: 'Microsoft.App/environments' } }]
        }
      }
      {
        name: 'db'
        properties: {
          addressPrefix: '10.40.2.0/24'
          delegations: [{ name: 'db', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }]
        }
      }
    ]
  }
}

resource dbDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: '${dbServerName}.private.postgres.database.azure.com'
  location: 'global'
  tags: tags
}

resource dbDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: dbDns
  name: '${name}-vnet'
  location: 'global'
  properties: { virtualNetwork: { id: vnet.id }, registrationEnabled: false }
}

// ── Identities: the app's (reads secrets, writes photos) and the secrets script's ──────────────
resource appId 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${name}-app-id'
  location: location
  tags: tags
}

resource setupId 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${name}-setup-id'
  location: location
  tags: tags
}

// ── Key Vault: session secret, push seed, database password ─────────────────────────────────
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

resource setupWritesSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, setupId.id, keyVaultSecretsOfficer)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsOfficer)
    principalId: setupId.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource appReadsSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, appId.id, keyVaultSecretsUser)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUser)
    principalId: appId.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// A template can't keep a random value from one deployment to the next, so a script makes each
// secret once, straight into the vault (secrets.sh), and leaves it alone after that.
resource secrets 'Microsoft.Resources/deploymentScripts@2023-08-01' = {
  name: '${name}-secrets'
  location: location
  tags: tags
  kind: 'AzureCLI'
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${setupId.id}': {} } }
  properties: {
    azCliVersion: '2.63.0'
    scriptContent: loadTextContent('secrets.sh')
    environmentVariables: [{ name: 'VAULT', value: vault.name }]
    forceUpdateTag: deployedAt
    timeout: 'PT30M'
    retentionInterval: 'PT1H'
    cleanupPreference: 'OnSuccess'
  }
  dependsOn: [setupWritesSecrets]
}

// ── Database ─────────────────────────────────────────────────────────────────────────────────
module db 'postgres.bicep' = {
  name: '${name}-postgres'
  params: {
    name: dbServerName
    location: location
    skuName: s.dbSku
    skuTier: s.dbTier
    storageGB: s.dbGB
    backupDays: s.backupDays
    adminLogin: dbUser
    adminPassword: vault.getSecret('postgres-password')
    databaseName: dbName
    subnetId: resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, 'db')
    privateDnsZoneId: dbDns.id
    tags: tags
  }
  dependsOn: [secrets, dbDnsLink]
}

// ── Photos ───────────────────────────────────────────────────────────────────────────────────
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // Only the app's identity: no account keys, no shared access signatures.
    allowSharedKeyAccess: false
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 14 }
    containerDeleteRetentionPolicy: { enabled: true, days: 14 }
  }
}

resource photos 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: photosContainer
  properties: { publicAccess: 'None' }
}

resource appWritesPhotos 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, appId.id, storageBlobDataContributor)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributor)
    principalId: appId.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── The app ──────────────────────────────────────────────────────────────────────────────────
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${name}-logs'
  location: location
  tags: tags
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${name}-env'
  location: location
  tags: tags
  properties: {
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    vnetConfiguration: { infrastructureSubnetId: resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, 'apps'), internal: false }
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: { customerId: logs.properties.customerId, sharedKey: logs.listKeys().primarySharedKey }
    }
  }
}

// The app's address, known before the app exists: <app>.<the environment's domain>.
var appUrl = 'https://${appName}.${env.properties.defaultDomain}'

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: tags
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${appId.id}': {} } }
  properties: {
    environmentId: env.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 3000, transport: 'auto', allowInsecure: false }
      // The platform reads these from Key Vault and hands them to the app as environment variables.
      secrets: [
        { name: 'session-secret', keyVaultUrl: '${vault.properties.vaultUri}secrets/session-secret', identity: appId.id }
        { name: 'vapid-seed', keyVaultUrl: '${vault.properties.vaultUri}secrets/vapid-seed', identity: appId.id }
        { name: 'postgres-password', keyVaultUrl: '${vault.properties.vaultUri}secrets/postgres-password', identity: appId.id }
      ]
    }
    template: {
      containers: [
        {
          name: 'opspoint'
          image: image
          resources: { cpu: json(s.cpu), memory: s.memory }
          env: [
            { name: 'OPSPOINT_PROFILE', value: 'azure' }
            { name: 'TZ', value: timeZone }
            { name: 'OPSPOINT_SECRETS', value: 'local' }
            // No password in the URL: node-postgres takes it from PGPASSWORD.
            { name: 'DATABASE_URL', value: 'postgresql://${dbUser}@${db.outputs.fqdn}:5432/${dbName}' }
            { name: 'PGPASSWORD', secretRef: 'postgres-password' }
            { name: 'SESSION_SECRET', secretRef: 'session-secret' }
            { name: 'VAPID_SEED', secretRef: 'vapid-seed' }
            { name: 'VAPID_SUBJECT', value: empty(contactEmail) ? appUrl : 'mailto:${contactEmail}' }
            { name: 'AZURE_STORAGE_ACCOUNT', value: storage.name }
            { name: 'AZURE_STORAGE_CONTAINER', value: photosContainer }
            { name: 'AZURE_CLIENT_ID', value: appId.properties.clientId }
          ]
          // /healthz fails only when the database can't be reached. The first start applies the
          // database schema, so it gets five minutes.
          probes: [
            { type: 'Startup', httpGet: { path: '/healthz', port: 3000 }, periodSeconds: 30, timeoutSeconds: 5, failureThreshold: 10 }
            { type: 'Liveness', httpGet: { path: '/healthz', port: 3000 }, periodSeconds: 30, timeoutSeconds: 5, failureThreshold: 3 }
            { type: 'Readiness', httpGet: { path: '/healthz', port: 3000 }, periodSeconds: 15, timeoutSeconds: 5, failureThreshold: 3 }
          ]
        }
      ]
      // One copy, always running: alerts and reminders run inside the app.
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
  dependsOn: [appReadsSecrets, appWritesPhotos, photos, secrets]
}

output appUrl string = appUrl
output setupUrl string = '${appUrl}/setup'
output setupCode string = 'The one-time setup code is in the app\'s log a minute after it first starts ("code XXXX-XXXX"): az containerapp logs show -g ${resourceGroup().name} -n ${app.name} --type console --tail 200, or the portal\'s Container App > Monitoring > Log stream.'
output customDomain string = 'To use your own domain: Container App > Custom domains > Add, with a managed certificate. Domain verification ID: ${env.properties.customDomainConfiguration.customDomainVerificationId}'
output baa string = 'Before real resident data goes in: Microsoft\'s HIPAA BAA, part of its Data Protection Addendum: https://learn.microsoft.com/compliance/regulatory/offering-hipaa-hitech'
