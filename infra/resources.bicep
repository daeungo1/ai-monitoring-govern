@description('Azure region.')
param location string
@description('Resource name prefix.')
param resourcePrefix string
@description('Entra user object ID.')
param principalId string
@description('Model deployments with explicit versions and quota capacities.')
param models array
@description('Optional email receiver.')
param alertEmail string?
@description('Five-minute estimated cost alert threshold.')
param costThresholdUsd int
@description('Enable alert evaluations.')
param isAlertingEnabled bool
@description('Skip ARM KQL validation only for first-data bootstrap.')
param shouldSkipQueryValidation bool
@description('Ownership and environment tags.')
param tags object

var deploymentNames = [for model in models: model.deployment]
var categories = ['Hate', 'Sexual', 'Violence', 'Selfharm']
var openAiUserRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
var promptFilters = [for category in categories: {
  name: category
  source: 'Prompt'
  enabled: true
  blocking: true
  severityThreshold: 'Medium'
}]
var completionFilters = [for category in categories: {
  name: category
  source: 'Completion'
  enabled: true
  blocking: true
  severityThreshold: 'Medium'
}]

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${resourcePrefix}-law'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: 1 }
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${resourcePrefix}-appi'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    IngestionMode: 'LogAnalytics'
    DisableIpMasking: false
  }
}

resource openai 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: '${resourcePrefix}-aoai'
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: '${resourcePrefix}-aoai'
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

resource safetyPolicy 'Microsoft.CognitiveServices/accounts/raiPolicies@2024-10-01' = {
  parent: openai
  name: 'demo-medium'
  properties: {
    basePolicyName: 'Microsoft.Default'
    contentFilters: concat(promptFilters, completionFilters)
  }
}

@batchSize(1)
resource deployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = [for model in models: {
  parent: openai
  name: model.deployment
  sku: {
    name: model.deploymentSku
    capacity: model.capacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: model.model
      version: model.modelVersion
    }
    versionUpgradeOption: 'NoAutoUpgrade'
    raiPolicyName: safetyPolicy.name
  }
}]

resource openAiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(openai.id, principalId, openAiUserRoleId)
  scope: openai
  properties: {
    principalId: principalId
    principalType: 'User'
    roleDefinitionId: openAiUserRoleId
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'metadata-and-metrics'
  scope: openai
  properties: {
    workspaceId: workspace.id
    logs: [
      { category: 'Audit', enabled: true }
    ]
    metrics: [
      { category: 'AllMetrics', enabled: true }
    ]
  }
}

resource actions 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: '${resourcePrefix}-actions'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'aoai-demo'
    enabled: true
    emailReceivers: alertEmail == null ? [] : [
      { name: 'demo-owner', emailAddress: alertEmail!, useCommonAlertSchema: true }
    ]
  }
}

var liveRequests = '''
AppDependencies
| where TimeGenerated > ago(15m)
| where Properties["telemetry.kind"] == "aoai.request" and Properties["demo.mode"] == "live"
| extend Status = toint(Properties["aoai.status_code"]), Outcome = tostring(Properties["aoai.outcome"]),
    Cost = todouble(Properties["aoai.estimated_cost_usd"]), Deployment=tostring(Properties["aoai.deployment"])
'''
var rules = [
  {
    name: 'error-rate'
    severity: 2
    threshold: 1
    query: '${liveRequests}\n| summarize Requests=count(), Errors=countif(Status >= 500 or Outcome == "network_error") by Deployment\n| where Requests >= 20 and 100.0 * Errors / Requests >= 5'
    description: 'Server/network errors >=5% with at least 20 attempts in 15m.'
  }
  {
    name: 'throttle-rate'
    severity: 2
    threshold: 1
    query: '${liveRequests}\n| summarize Requests=count(), Throttled=countif(Status == 429) by Deployment\n| where Requests >= 20 and 100.0 * Throttled / Requests >= 5'
    description: '429 rate >=5% with at least 20 attempts in 15m.'
  }
  {
    name: 'latency-p95'
    severity: 2
    threshold: 1
    query: '${liveRequests}\n| where Outcome == "success"\n| summarize Requests=count(), P95Ms=percentile(DurationMs, 95) by Deployment\n| where Requests >= 20 and P95Ms > 5000'
    description: 'Successful full request/stream duration p95 >5s with at least 20 attempts in 15m; separate from TTFT.'
  }
  {
    name: 'estimated-spend'
    severity: 2
    threshold: costThresholdUsd
    query: '${liveRequests}\n| where TimeGenerated > ago(5m) and isnotnull(Cost)\n| summarize EstimatedUsd=sum(Cost)'
    description: 'Recorded rate-version estimated USD spend in 5m. Not invoiced cost; excludes unknown usage/prices.'
  }
  {
    name: 'filter-unavailable'
    severity: 1
    threshold: 1
    query: '${liveRequests}\n| where Outcome == "filter_unavailable"'
    description: 'Content-filter service failure. Review fail-open handling.'
  }
  {
    name: 'streaming-ttft-p95'
    severity: 2
    threshold: 1
    query: '${liveRequests}\n| where tobool(Properties["aoai.streaming"])\n| extend TTFT=todouble(Properties["aoai.ttft_ms"])\n| where isnotnull(TTFT)\n| summarize Requests=count(), P95Ms=percentile(TTFT,95) by Deployment\n| where Requests >= 20 and P95Ms > 3000'
    description: 'Streaming visible-content client TTFT p95 >3s with >=20 observations per deployment in 15m.'
  }
  {
    name: 'streaming-incomplete'
    severity: 2
    threshold: 3
    query: '${liveRequests}\n| where Outcome == "stream_incomplete"'
    description: 'At least 3 live streams ended without terminal finish in 15m; user cancellations are separate.'
  }
]

resource logAlerts 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = [for rule in rules: {
  name: '${resourcePrefix}-${rule.name}'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: 'AOAI ${rule.name}'
    description: rule.description
    enabled: isAlertingEnabled
    severity: rule.severity
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    scopes: [workspace.id]
    autoMitigate: true
    skipQueryValidation: shouldSkipQueryValidation
    criteria: {
      allOf: [
        {
          query: rule.query
          timeAggregation: rule.name == 'estimated-spend' ? 'Total' : 'Count'
          metricMeasureColumn: rule.name == 'estimated-spend' ? 'EstimatedUsd' : null
          operator: 'GreaterThanOrEqual'
          threshold: rule.threshold
          failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
        }
      ]
    }
    actions: { actionGroups: [actions.id] }
  }
}]

resource nativeTokenAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${resourcePrefix}-native-token-volume'
  location: 'global'
  tags: tags
  properties: {
    description: 'Demo generated-token volume >100000 in 5m. Not a quota-utilization percentage.'
    severity: 3
    enabled: isAlertingEnabled
    scopes: [openai.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'generated-token-volume'
          metricNamespace: 'Microsoft.CognitiveServices/accounts'
          metricName: 'GeneratedTokens'
          operator: 'GreaterThan'
          threshold: 100000
          timeAggregation: 'Total'
          criterionType: 'StaticThresholdCriterion'
          dimensions: [
            { name: 'ModelDeploymentName', operator: 'Include', values: deploymentNames }
          ]
        }
      ]
    }
    actions: [{ actionGroupId: actions.id }]
  }
}

var workbookData = replace(
  replace(
    replace(
      replace(
        replace(string(loadJsonContent('workbook.json')), '__WORKSPACE_RESOURCE_ID__', workspace.id),
        '__OPENAI_RESOURCE_ID__', openai.id),
      '__SUBSCRIPTION_ID__', subscription().subscriptionId),
    '__RESOURCE_GROUP__', resourceGroup().name),
  '__ACTION_GROUP_ID__', actions.id)

resource workbook 'Microsoft.Insights/workbooks@2022-04-01' = {
  name: guid(workspace.id, 'aoai-operations-workbook')
  location: location
  tags: tags
  kind: 'shared'
  properties: {
    displayName: 'Azure OpenAI API Operations Demo'
    sourceId: workspace.id
    category: 'workbook'
    serializedData: workbookData
  }
}

var dashboardData = json(replace(
  replace(
    replace(
      replace(string(loadJsonContent('dashboard.json')), '__OPENAI_RESOURCE_ID__', openai.id),
      '__WORKBOOK_RESOURCE_ID__', workbook.id),
    '__WORKSPACE_RESOURCE_ID__', workspace.id),
  '__ACTION_GROUP_ID__', actions.id))

resource dashboard 'Microsoft.Portal/dashboards@2020-09-01-preview' = {
  name: '${resourcePrefix}-dashboard'
  location: location
  tags: union(tags, { 'hidden-title': 'AI Observability - Azure Native' })
  properties: {
    lenses: dashboardData.lenses
    metadata: dashboardData.metadata
  }
}

var logAlertIds = [for i in range(0, length(rules)): logAlerts[i].id]

@description('Non-secret settings for the local CLI.')
output settings object = {
  resourceGroupName: resourceGroup().name
  location: location
  openAiResourceId: openai.id
  openAiAccountName: openai.name
  endpoint: openai.properties.endpoint
  models: models
  workspaceResourceId: workspace.id
  workspaceId: workspace.properties.customerId
  applicationInsightsResourceId: insights.id
  applicationInsightsName: insights.name
  workbookResourceId: workbook.id
  dashboardResourceId: dashboard.id
  actionGroupId: actions.id
  logAlertIds: logAlertIds
  metricAlertId: nativeTokenAlert.id
}
@secure()
@description('Application Insights connection string.')
output applicationInsightsConnectionString string = insights.properties.ConnectionString
