@description('Managed Grafana region.')
param location string
@description('Unique Managed Grafana workspace name.')
@minLength(2)
@maxLength(23)
param grafanaName string
@description('Demonstration administrator Entra object ID.')
param administratorId string
@description('Log Analytics workspace name.')
param workspaceName string
@description('OpenAI account name.')
param openAiName string
@description('Ownership tags.')
param tags object
resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = { name: workspaceName }
resource openai 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = { name: openAiName }
resource grafana 'Microsoft.Dashboard/grafana@2025-08-01' = {
  name: grafanaName
  location: location
  tags: tags
  sku: { name: 'Standard' }
  identity: { type: 'SystemAssigned' }
  properties: {
    apiKey: 'Disabled'
    grafanaMajorVersion: '12'
    publicNetworkAccess: 'Enabled'
    zoneRedundancy: 'Disabled'
    deterministicOutboundIP: 'Disabled'
    grafanaConfigurations: {
      users: { viewersCanEdit: false, editorsCanAdmin: false }
      snapshots: { externalEnabled: false }
    }
  }
}
var grafanaAdmin = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '22926164-76b3-42b3-bc55-97df8dab3e41')
var logReader = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '73c42c96-874c-492b-b04d-ab87d138a893')
var monitorReader = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '43d0d8ad-25c7-4714-9337-8ba259a9fe05')
resource admin 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: grafana
  name: guid(grafana.id, administratorId, grafanaAdmin)
  properties: { principalId: administratorId, principalType: 'User', roleDefinitionId: grafanaAdmin }
}
resource logs 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: workspace
  name: guid(workspace.id, grafana.id, logReader)
  properties: { principalId: grafana.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: logReader }
}
resource metrics 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: openai
  name: guid(openai.id, grafana.id, monitorReader)
  properties: { principalId: grafana.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: monitorReader }
}
@description('Managed Grafana Entra-authenticated endpoint.')
output endpoint string = grafana.properties.endpoint
@description('Managed identity principal ID.')
output principalId string = grafana.identity.principalId
@description('Grafana resource ID.')
output resourceId string = grafana.id
