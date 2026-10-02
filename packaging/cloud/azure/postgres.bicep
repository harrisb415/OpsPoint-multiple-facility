// OpsPoint on Azure: the PostgreSQL Flexible Server (a module of main.bicep, so its password can
// come from Key Vault: main.bicep's deployment script makes it once).

param name string
param location string
param skuName string
param skuTier string
param storageGB int
param backupDays int
param adminLogin string
@secure()
param adminPassword string
param databaseName string
param subnetId string
param privateDnsZoneId string
param tags object

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: name
  location: location
  tags: tags
  sku: { name: skuName, tier: skuTier }
  properties: {
    version: '16'
    administratorLogin: adminLogin
    administratorLoginPassword: adminPassword
    storage: { storageSizeGB: storageGB, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: backupDays, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    // Reached only from inside the virtual network, through its private DNS zone.
    network: { delegatedSubnetResourceId: subnetId, privateDnsZoneArmResourceId: privateDnsZoneId, publicNetworkAccess: 'Disabled' }
    authConfig: { activeDirectoryAuth: 'Disabled', passwordAuth: 'Enabled' }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: databaseName
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

output fqdn string = server.properties.fullyQualifiedDomainName
