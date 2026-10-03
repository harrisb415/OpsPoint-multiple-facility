// OpsPoint on Azure: the database, given its password from Key Vault (a module of main.bicep).
// Azure checks a Key Vault reference before the deployment starts whenever it can work out the
// vault's name then, and on a first deployment the vault doesn't exist yet. main.bicep passes the
// name from the secrets script's output, a value known only once the script has filled the vault,
// so the reference is checked here, when the database is made.

param vaultName string
param name string
param location string
param skuName string
param skuTier string
param storageGB int
param backupDays int
param adminLogin string
param databaseName string
param subnetId string
param privateDnsZoneId string
param tags object

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: vaultName
}

module server 'postgres.bicep' = {
  name: '${name}-server'
  params: {
    name: name
    location: location
    skuName: skuName
    skuTier: skuTier
    storageGB: storageGB
    backupDays: backupDays
    adminLogin: adminLogin
    adminPassword: vault.getSecret('postgres-password')
    databaseName: databaseName
    subnetId: subnetId
    privateDnsZoneId: privateDnsZoneId
    tags: tags
  }
}

output fqdn string = server.outputs.fqdn
