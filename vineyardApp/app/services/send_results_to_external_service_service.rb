require 'faraday'
require 'faraday/multipart'
require 'uri'

class SendResultsToExternalServiceService
  def initialize(video)
    @video = video
  end

  def send_results
    return false unless @video.external_service?
    return false unless @video.status == 'completed'

    send_to_external_service
  end

  private

  def send_to_external_service
    results = callback_payload

    conn = Faraday.new(url: @video.external_service_url) do |faraday|
      faraday.request :json
      faraday.adapter Faraday.default_adapter
      faraday.options.timeout = 30
    end

    headers = {}
    headers['Authorization'] = "Bearer #{@video.external_callback_token}" if @video.external_callback_token.present?

    response = conn.post(resolved_callback_path) do |req|
      req.headers.merge!(headers)
      req.body = results.to_json
    end

    if response.status >= 200 && response.status < 300
      Rails.logger.info("Results sent to external service for video #{@video.id}, mission #{@video.mission_id}")
      true
    else
      Rails.logger.error("Failed to send results to external service: #{response.status} - #{response.body}")
      false
    end
  rescue => e
    Rails.logger.error("SendResultsToExternalServiceService error: #{e.message}")
    Rails.logger.error(e.backtrace.join("\n"))
    false
  end

  def callback_payload
    payload = @video.aggregated_results
    # Keep real positions in callback so Drones backend can render vineyard scheme.
    # Payload trimming can be reintroduced later behind an explicit env flag if needed.
    payload
  end

  def resolved_callback_path
    default_path = '/api/v1/vineyard_app/results'
    configured_path = ENV.fetch('EXTERNAL_RESULTS_PATH', '').to_s.strip
    return default_path if configured_path.empty?
    return default_path if configured_path.include?('%{')

    if configured_path.start_with?('http://', 'https://')
      uri = URI.parse(configured_path)
      path = uri.request_uri
      return default_path if path.blank?
      return path
    end

    configured_path.start_with?('/') ? configured_path : "/#{configured_path}"
  rescue URI::InvalidURIError
    default_path
  end
end
