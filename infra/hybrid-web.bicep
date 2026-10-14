@description('Azure hosting region.')
param location string
@description('Globally unique web app name.')
param webAppName string
@description('Entra single-tenant application client ID for Easy Auth.')
param clientId string
@description('Allowed Entra user object ID for the demonstration.')
param allowedUserId string
@secure()
@description('Entra authentication client secret; never persist in source.')
param clientSecret string
@description('Log Analytics workspace name in this resource group.')
param workspaceName string
@description('Application Insights resource name.')
param applicationInsightsName string
@description('Azure OpenAI resource name.')
param openAiName string
@description('Ownership tags.')
param tags object

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = { name: workspaceName }
resource insights 'Microsoft.Insights/components@2020-02-02' existing = { name: applicationInsightsName }
resource openai 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = { name: openAiName }

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${webAppName}-plan'
  location: location
  tags: tags
  sku: { name: 'B1', tier: 'Basic', capacity: 1 }
  kind: 'linux'
  properties: { reserved: true }
}
resource web 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  tags: tags
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      appCommandLine: 'npm run start:azure'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        { name: 'NODE_ENV', value: 'production' }
        { name: 'DATA_SOURCE', value: 'live' }
        { name: 'SERVE_STATIC', value: 'true' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'true' }
        { name: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET', value: clientSecret }
        { name: 'AZURE_TENANT_ID', value: subscription().tenantId }
        { name: 'LOG_ANALYTICS_WORKSPACE_ID', value: workspace.properties.customerId }
        { name: 'APPINSIGHTS_RESOURCE_ID', value: insights.id }
        { name: 'FOUNDRY_RESOURCE_ID', value: openai.id }
        { name: 'AZURE_SUBSCRIPTION_ID', value: subscription().subscriptionId }
      ]
    }
  }
}
resource auth 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: web
  name: 'authsettingsV2'
  properties: {
    platform: { enabled: true }
    globalValidation: { requireAuthentication: true, unauthenticatedClientAction: 'Return401' }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: clientId
          openIdIssuer: '${environment().authentication.loginEndpoint}${subscription().tenantId}/v2.0'
          clientSecretSettingName: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET'
        }
        validation: {
          allowedAudiences: [clientId, 'api://${clientId}']
          defaultAuthorizationPolicy: { allowedPrincipals: { identities: [allowedUserId] } }
        }
      }
    }
    login: { tokenStore: { enabled: true } }
    httpSettings: { requireHttps: true }
  }
}
var logReader = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '73c42c96-874c-492b-b04d-ab87d138a893')
var monitorReader = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '43d0d8ad-25c7-4714-9337-8ba259a9fe05')
resource logRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: workspace
  name: guid(workspace.id, web.id, logReader)
  properties: { principalId: web.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: logReader }
}
resource metricRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: openai
  name: guid(openai.id, web.id, monitorReader)
  properties: { principalId: web.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: monitorReader }
}
resource insightsReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: insights
  name: guid(insights.id, web.id, monitorReader)
  properties: { principalId: web.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: monitorReader }
}
resource scmAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: web
  name: 'scm'
  properties: { allow: false }
}
resource ftpAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: web
  name: 'ftp'
  properties: { allow: false }
}
@description('Authenticated hybrid dashboard endpoint.')
output endpoint string = 'https://${web.properties.defaultHostName}'
@description('Managed identity principal ID.')
output principalId string = web.identity.principalId
