locals {
  athom_homey_service_name       = "Athom Homey App"
  athom_homey_apm_application_id = "103830695"
  athom_homey_runbook_url        = "https://www.notion.so/tibber/AthomHomeyApp-Runbook"
}

resource "newrelic_alert_policy" "athom_homey" {
  name                = "${local.athom_homey_service_name} Alert Policy"
  incident_preference = "PER_CONDITION_AND_TARGET"
}

resource "newrelic_workflow" "athom_homey" {
  name                  = "Policy: ${newrelic_alert_policy.athom_homey.id} - ${newrelic_alert_policy.athom_homey.name}"
  muting_rules_handling = "NOTIFY_ALL_ISSUES"

  issues_filter {
    name = "filter-athom-homey-policy"
    type = "FILTER"

    predicate {
      attribute = "labels.policyIds"
      operator  = "EXACTLY_MATCHES"
      values    = [newrelic_alert_policy.athom_homey.id]
    }
  }

  destination {
    channel_id = newrelic_notification_channel.athom_homey.id
  }
}

resource "newrelic_notification_channel" "athom_homey" {
  name           = "athom-homey-slack-notification-channel"
  type           = "SLACK"
  destination_id = newrelic_notification_destination.slack.id
  product        = "IINT"

  property {
    key   = "channelId"
    value = var.smart_home_slack_channel_id
  }

  property {
    key   = "customDetailsSlack"
    value = "issue id - {{issueId}}"
  }
}

resource "newrelic_alert_condition" "athom_homey_throughput_below_1_tpm" {
  policy_id = newrelic_alert_policy.athom_homey.id

  name            = "No Traffic: Throughput Below 1 TPM"
  type            = "apm_app_metric"
  entities        = [local.athom_homey_apm_application_id]
  metric          = "throughput_web"
  runbook_url     = local.athom_homey_runbook_url
  condition_scope = "application"

  term {
    duration      = 5
    operator      = "below"
    priority      = "critical"
    threshold     = "1"
    time_function = "all"
  }
}

resource "newrelic_alert_condition" "athom_homey_error_rate" {
  policy_id = newrelic_alert_policy.athom_homey.id

  name            = "Error Rate"
  type            = "apm_app_metric"
  entities        = [local.athom_homey_apm_application_id]
  metric          = "error_percentage"
  runbook_url     = local.athom_homey_runbook_url
  condition_scope = "application"

  term {
    duration      = 60
    operator      = "above"
    priority      = "critical"
    threshold     = "6"
    time_function = "all"
  }
}

resource "newrelic_nrql_alert_condition" "athom_homey_apdex_score" {
  policy_id                    = newrelic_alert_policy.athom_homey.id
  type                         = "static"
  name                         = "Apdex Score"
  description                  = "This alert is triggered when the Apdex score is below 0.5 for 1 hour"
  enabled                      = false
  violation_time_limit_seconds = 86400

  nrql {
    query = "SELECT apdex(duration, t: 0.5) FROM Transaction WHERE appName like '%'"
  }

  critical {
    operator              = "below"
    threshold             = 0.5
    threshold_duration    = 3600
    threshold_occurrences = "all"
  }
  fill_option        = "none"
  aggregation_window = 60
  aggregation_method = "event_flow"
  aggregation_delay  = 120
}