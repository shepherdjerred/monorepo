// Patched SMTPClient::Server to handle localhost and IP addresses
// Bug: Postal's DNSResolver only does DNS lookups, not /etc/hosts
// This causes localhost-based SMTP relays to fail with "No hosts to try"
export const PATCHED_SMTP_CLIENT_SERVER = String.raw`# frozen_string_literal: true

module SMTPClient
  class Server

    attr_reader :hostname
    attr_reader :port
    attr_accessor :ssl_mode

    def initialize(hostname, port: 25, ssl_mode: SSLModes::AUTO)
      @hostname = hostname
      @port = port
      @ssl_mode = ssl_mode
    end

    # Return all IP addresses for this server by resolving its hostname.
    # IPv6 addresses will be returned first.
    #
    # PATCHED: Handle localhost and IP addresses directly without DNS resolution
    #
    # @return [Array<SMTPClient::Endpoint>]
    def endpoints
      ips = []

      # Handle localhost specially - DNS won't resolve it
      if @hostname == "localhost"
        ips << Endpoint.new(self, "127.0.0.1")
        return ips
      end

      # Handle IP addresses directly (IPv4 and IPv6)
      if @hostname =~ /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/ || @hostname.include?(":")
        ips << Endpoint.new(self, @hostname)
        return ips
      end

      # Standard DNS resolution for regular hostnames
      DNSResolver.local.aaaa(@hostname).each do |ip|
        ips << Endpoint.new(self, ip)
      end

      DNSResolver.local.a(@hostname).each do |ip|
        ips << Endpoint.new(self, ip)
      end

      ips
    end

  end
end
`;

// Patched smtp_sender.rb to fix SMTP relay bug in Postal 3.1.1
// Bug: SMTPClient::Server.new was called with positional args instead of keyword args
// Bug: The .map result wasn't assigned, so relays were never actually used
export const PATCHED_SMTP_SENDER = String.raw`# frozen_string_literal: true

class SMTPSender < BaseSender

  attr_reader :endpoints

  def initialize(domain, source_ip_address = nil, servers: nil, log_id: nil, rcpt_to: nil)
    super()
    @domain = domain
    @source_ip_address = source_ip_address
    @rcpt_to = rcpt_to
    @servers = servers
    @connection_errors = []
    @endpoints = []
    @log_id = log_id || SecureRandom.alphanumeric(8).upcase
  end

  def start
    servers = @servers || self.class.smtp_relays || resolve_mx_records_for_domain || []

    servers.each do |server|
      server.endpoints.each do |endpoint|
        result = connect_to_endpoint(endpoint)
        return endpoint if result
      end
    end

    false
  end

  def send_message(message)
    if @current_endpoint.nil?
      return create_result("SoftFail") do |r|
        r.retry = true
        r.details = "No SMTP servers were available for #{@domain}."
        if @endpoints.empty?
          r.details += " No hosts to try."
        else
          hostnames = @endpoints.map { |e| e.server.hostname }.uniq
          r.details += " Tried #{hostnames.to_sentence}."
        end
        r.output = @connection_errors.join(", ")
        r.connect_error = true
      end
    end

    mail_from = determine_mail_from_for_message(message)
    raw_message = message.raw_message

    if Postal::Config.postal.use_resent_sender_header?
      raw_message = "Resent-Sender: #{mail_from}\r\n" + raw_message
    end

    rcpt_to = determine_rcpt_to_for_message(message)
    logger.info "Sending message #{message.server.id}::#{message.id} to #{rcpt_to}"
    send_message_to_smtp_client(raw_message, mail_from, rcpt_to)
  end

  def finish
    @endpoints.each(&:finish_smtp_session)
  end

  private

  def send_message_to_smtp_client(raw_message, mail_from, rcpt_to, retry_on_connection_error: true)
    start_time = Time.now
    smtp_result = @current_endpoint.send_message(raw_message, mail_from, [rcpt_to])
    logger.info "Accepted by #{@current_endpoint} for #{rcpt_to}"
    create_result("Sent", start_time) do |r|
      r.details = "Message for #{rcpt_to} accepted by #{@current_endpoint}"
      r.details += " (from #{@current_endpoint.smtp_client.source_address})" if @current_endpoint.smtp_client.source_address
      r.output = smtp_result.string
    end
  rescue Net::SMTPServerBusy, Net::SMTPAuthenticationError, Net::SMTPSyntaxError, Net::SMTPUnknownError, Net::ReadTimeout => e
    logger.error "#{e.class}: #{e.message}"
    @current_endpoint.reset_smtp_session

    create_result("SoftFail", start_time) do |r|
      r.details = "Temporary SMTP delivery error when sending to #{@current_endpoint}"
      r.output = e.message
      if e.message =~ /(\d+) seconds/
        r.retry = ::Regexp.last_match(1).to_i + 10
      elsif e.message =~ /(\d+) minutes/
        r.retry = (::Regexp.last_match(1).to_i * 60) + 10
      else
        r.retry = true
      end
    end
  rescue Net::SMTPFatalError => e
    logger.error "#{e.class}: #{e.message}"
    @current_endpoint.reset_smtp_session

    create_result("HardFail", start_time) do |r|
      r.details = "Permanent SMTP delivery error when sending to #{@current_endpoint}"
      r.output = e.message
    end
  rescue StandardError => e
    logger.error "#{e.class}: #{e.message}"
    @current_endpoint.reset_smtp_session

    create_result("SoftFail", start_time) do |r|
      r.type = "SoftFail"
      r.retry = true
      r.details = "An error occurred while sending the message to #{@current_endpoint}"
      r.output = e.message
    end
  end

  def determine_mail_from_for_message(message)
    return "" if message.bounce

    if message.domain.return_path_status == "OK"
      return "#{message.server.token}@#{message.domain.return_path_domain}"
    end

    "#{message.server.token}@#{Postal::Config.dns.return_path_domain}"
  end

  def determine_rcpt_to_for_message(message)
    return @rcpt_to if @rcpt_to

    message.rcpt_to
  end

  def resolve_mx_records_for_domain
    hostnames = DNSResolver.local.mx(@domain, raise_timeout_errors: true).map(&:last)
    return [SMTPClient::Server.new(@domain)] if hostnames.empty?

    hostnames.map { |hostname| SMTPClient::Server.new(hostname) }
  end

  def connect_to_endpoint(endpoint, allow_ssl: true)
    if @source_ip_address && @source_ip_address.ipv6.blank? && endpoint.ipv6?
      return false
    end

    @endpoints << endpoint unless @endpoints.include?(endpoint)

    endpoint.start_smtp_session(allow_ssl: allow_ssl, source_ip_address: @source_ip_address)
    logger.info "Connected to #{endpoint}"
    @current_endpoint = endpoint

    true
  rescue StandardError => e
    endpoint.finish_smtp_session

    if e.is_a?(OpenSSL::SSL::SSLError) && endpoint.server.ssl_mode == "Auto"
      logger.error "SSL error (#{e.message}), retrying without SSL"
      return connect_to_endpoint(endpoint, allow_ssl: false)
    end

    logger.error "Cannot connect to #{endpoint} (#{e.class}: #{e.message})"
    @connection_errors << e.message unless @connection_errors.include?(e.message)

    false
  end

  def create_result(type, start_time = nil)
    result = SendResult.new
    result.type = type
    result.log_id = @log_id
    result.secure = @current_endpoint&.smtp_client&.secure_socket? ? true : false
    yield result if block_given?
    if start_time
      result.time = (Time.now - start_time).to_f.round(2)
    end
    result
  end

  def logger
    @logger ||= Postal.logger.create_tagged_logger(log_id: @log_id)
  end

  class << self

    # PATCHED: Fixed SMTPClient::Server.new call to use keyword arguments
    # and properly assign the map result
    def smtp_relays
      return @smtp_relays if instance_variable_defined?("@smtp_relays")

      relays = Postal::Config.postal.smtp_relays
      return nil if relays.nil?

      @smtp_relays = relays.map do |relay|
        next unless relay.host.present?

        SMTPClient::Server.new(relay.host, port: relay.port, ssl_mode: relay.ssl_mode)
      end.compact

      @smtp_relays.empty? ? nil : @smtp_relays
    end

  end

end
`;
