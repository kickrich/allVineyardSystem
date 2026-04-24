require 'faraday'
require 'faraday/multipart'

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
    results = @video.aggregated_results

    conn = Faraday.new(url: @video.external_service_url) do |faraday|
      faraday.request :json
      faraday.adapter Faraday.default_adapter
      faraday.options.timeout = 30
    end

    headers = {}
    headers['Authorization'] = "Bearer #{@video.external_callback_token}" if @video.external_callback_token.present?

    response = conn.post('/api/missions/results') do |req|
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
end
