mock_provider "cloudflare" {}

mock_provider "http" {
  mock_data "http" {
    defaults = {
      status_code      = 200
      response_body    = "version: STSv1\nmode: enforce\nmx: in1-smtp.messagingengine.com\nmx: in2-smtp.messagingengine.com\nmax_age: 86400\n"
      response_headers = { Content-Type = "text/plain; charset=utf-8" }
    }
  }
}

variables {
  zone_id           = "d4036b55fca60ca5f998866309e951d8"
  domain            = "example.com"
  fastmail_ready    = true
  wildcard_mail     = true
  tls_1_3           = "on"
  mta_sts_published = false
  mail_policy = {
    version = "STSv1"
    mode    = "enforce"
    mx      = ["in1-smtp.messagingengine.com", "in2-smtp.messagingengine.com"]
    maxAge  = 86400
  }
}

run "bootstrap_without_discovery" {
  command = plan
  module { source = "./modules/domain-baseline" }
  assert {
    condition     = length(cloudflare_dns_record.mta_sts) == 0 && length(data.http.mail_policy) == 0
    error_message = "Bootstrap must provision the policy host without advertising enforcement or requiring a live endpoint."
  }
}

run "configure_certificate_alert_delivery" {
  command = plan
  module { source = "./modules/domain-baseline" }
  assert {
    condition = (
      length(cloudflare_ct_alerting.ct) == 1 &&
      cloudflare_ct_alerting.ct[0].enabled &&
      cloudflare_ct_alerting.ct[0].emails == tolist(["root@sjer.red"]) &&
      length(cloudflare_ct_alerting.ct_existing) == 0
    )
    error_message = "Enabling certificate monitoring must configure delivery to the owned inbox."
  }
}

run "preserve_existing_certificate_alert_recipients" {
  command = plan
  module { source = "./modules/domain-baseline" }
  variables { ct_alert_recipient = null }
  assert {
    condition = (
      length(cloudflare_ct_alerting.ct) == 0 &&
      length(cloudflare_ct_alerting.ct_existing) == 1 &&
      cloudflare_ct_alerting.ct_existing[0].enabled
    )
    error_message = "Adopting existing alerts must retain their recipient configuration."
  }
}

run "wait_for_fastmail_onboarding" {
  command = plan
  module { source = "./modules/domain-baseline" }
  variables { fastmail_ready = false }
  assert {
    condition = (
      length(cloudflare_dns_record.mx) == 0 &&
      length(cloudflare_dns_record.wildcard_mx) == 0 &&
      cloudflare_dns_record.spf.content == "v=spf1 -all"
    )
    error_message = "Unregistered domains must not advertise mail routing or authorize outbound mail."
  }
}

run "publish_verified_policy" {
  command = plan
  module { source = "./modules/domain-baseline" }
  variables { mta_sts_published = true }
  assert {
    condition     = cloudflare_dns_record.mta_sts[0].content == "v=STSv1; id=${substr(sha256(data.http.mail_policy[0].response_body), 0, 16)}"
    error_message = "Discovery revision must identify the exact served policy."
  }
}

run "reject_error_page" {
  command = plan
  module { source = "./modules/domain-baseline" }
  variables { mta_sts_published = true }
  override_data {
    target = data.http.mail_policy
    values = {
      status_code      = 200
      response_body    = "<html>Origin unavailable</html>"
      response_headers = { Content-Type = "text/html" }
    }
  }
  expect_failures = [cloudflare_dns_record.mta_sts]
}

run "reject_unavailable_policy" {
  command = plan
  module { source = "./modules/domain-baseline" }
  variables { mta_sts_published = true }
  override_data {
    target = data.http.mail_policy
    values = {
      status_code      = 404
      response_body    = "version: STSv1\nmode: enforce\nmx: in1-smtp.messagingengine.com\nmx: in2-smtp.messagingengine.com\nmax_age: 86400\n"
      response_headers = { Content-Type = "text/plain" }
    }
  }
  expect_failures = [cloudflare_dns_record.mta_sts]
}
