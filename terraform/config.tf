provider "aws" {
  region = var.aws_region
  assume_role {
    role_arn = var.aws_role_arn
  }
  default_tags {
    tags = merge(
      var.default_tags,
      {
        "environment": var.environment,
        "region": var.aws_region,
      })
  }
}

provider "newrelic" {
  account_id = var.newrelic_account_id
  api_key    = var.newrelic_api_key
  region     = var.newrelic_region
}

terraform {
  required_version = "= 1.10.4"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
	newrelic = {
      source  = "newrelic/newrelic"
      version = "3.46.0"
	}
  }
  backend "s3" {
    assume_role = {
		role_arn = "arn:aws:iam::766078087081:role/TerraformDeployer"
	}
    skip_metadata_api_check = true
    bucket                  = "tibber-terraform-state"
    key                     = "com.tibber.athom/terraform.tfstate"
    region                  = "eu-west-1"
    dynamodb_table          = "tibber-terraform-state-locks"
    encrypt                 = true
  }
}
