require "json"

class FetchVineyardProcessingStatusService
  def initialize(mission)
    @mission = mission
    @vineyard_app_url = ENV.fetch("VINEYARD_APP_URL", "http://localhost:3000")
  end

  def call
    conn = Faraday.new(url: @vineyard_app_url) do |faraday|
      faraday.adapter Faraday.default_adapter
      faraday.options.timeout = 15
    end

    response = conn.get("/api/missions/#{@mission.id}/status")

    if response.status == 404
      return unavailable_payload(phase: "waiting")
    end

    unless response.status.in?(200..299)
      raise "VineyardApp status failed: #{response.status} - #{response.body}"
    end

    data = JSON.parse(response.body)
    normalize(data)
  rescue JSON::ParserError => e
    Rails.logger.error("[FetchVineyardProcessingStatusService] JSON error mission=#{@mission.id}: #{e.message}")
    unavailable_payload(phase: "error", message: "Некорректный ответ VineyardApp")
  rescue StandardError => e
    Rails.logger.error("[FetchVineyardProcessingStatusService] mission=#{@mission.id}: #{e.message}")
    unavailable_payload(phase: "error", message: e.message)
  end

  private

  def unavailable_payload(phase:, message: nil)
    {
      mission_id: @mission.id,
      available: false,
      phase: phase,
      video_status: nil,
      processing_progress: nil,
      shards_count: nil,
      processed_shards: nil,
      rows_count: nil,
      message: message
    }
  end

  def normalize(data)
    progress = data["processing_progress"]
    progress = progress.to_i if progress.present?

    {
      mission_id: @mission.id,
      available: true,
      phase: "processing",
      video_id: data["video_id"],
      video_status: data["status"],
      processing_progress: progress,
      shards_count: data["shards_count"]&.to_i,
      processed_shards: data["processed_shards"]&.to_i,
      rows_count: data["rows_count"]&.to_i,
      statistics: data["statistics"],
      shards: Array(data["shards"]),
      updated_at: data["updated_at"]
    }
  end
end
