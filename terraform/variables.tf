variable default_tags {
  description = "A map of tags to add to all resources"
  type        = map(string)
  default     = {
    terraform      = "true"
    created-by     = "terraform"
    repository     = "https://github.com/tibber/com.tibber.athom"
    owner          = "squad-smart-home"
    application    = "com.tibber.athom"
    customer-level = "premium"
  }
}

variable aws_role_arn {
  description = "ARN for the role that will be used to create resources in AWS"
  type        = string
}

variable aws_region {
  type        = string
}

variable environment {
  type = string
}

variable cluster_name {
  type = string
}

variable newrelic_api_key {
  type = string
}

variable newrelic_account_id {
  type = string
}

variable newrelic_region {
  type    = string
} 

variable newrelic_notification_destination_slack_id {
  type = string
}

variable "smart_home_slack_channel_id" {
  type = string
  #bot-smart-home-alarms-prod
  default = "C074KPPJWDR"
}
