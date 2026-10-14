targetScope = 'subscription'

@description('Dedicated demo resource group name.')
param resourceGroupName string
@description('Azure region for the demo.')
param location string = 'eastus2'
@description('Globally unique, lowercase resource name prefix.')
@minLength(3)
@maxLength(40)
param resourcePrefix string
@description('Object ID of the Entra user running the local demo.')
param principalId string
@description('User display name for deployment attribution.')
param deployedBy string
@description('Session identifier for demo ownership.')
param sessionId string
@description('Deployment timestamp.')
param createdAt string = utcNow()
@description('Exact deployment/model/version/SKU/capacity entries, checked against regional availability.')
param models array = loadJsonContent('../config/models.json').models
@description('Optional notification email. Null creates an action group with no email receiver.')
param alertEmail string?
@description('Estimated USD spend threshold within five minutes. Not a billing budget.')
@minValue(1)
param costThresholdUsd int = 5
@description('Enable paid alert evaluations. Disable when the demo is not in use.')
param isAlertingEnabled bool = true
@description('Bootstrap only: skip ARM KQL validation until first data creates tables. Set false after ingestion.')
param shouldSkipQueryValidation bool = true

var tags = {
  'app-onboard-skill': 'true'
  'app-onboard-session-id': sessionId
  'created-at': createdAt
  environment: 'demo'
  'deployed-by': deployedBy
  project: 'azure-openai-monitoring-demo'
}

resource demoGroup 'Microsoft.Resources/resourceGroups@2025-04-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module resources 'resources.bicep' = {
  name: 'aoai-monitoring-resources'
  scope: demoGroup
  params: {
    location: location
    resourcePrefix: resourcePrefix
    principalId: principalId
    models: models
    alertEmail: alertEmail
    costThresholdUsd: costThresholdUsd
    isAlertingEnabled: isAlertingEnabled
    shouldSkipQueryValidation: shouldSkipQueryValidation
    tags: tags
  }
}

@description('Resource IDs and non-secret demo settings.')
output settings object = resources.outputs.settings
@secure()
@description('Application Insights ingestion connection string. Keep out of published artifacts.')
output applicationInsightsConnectionString string = resources.outputs.applicationInsightsConnectionString
