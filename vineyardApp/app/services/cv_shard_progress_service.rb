require "faraday"
require "json"

class CvShardProgressService
  def self.fetch(shard_id)
    base = ENV.fetch("CV_SERVICE_URL", "http://localhost:8000")
    conn = Faraday.new(url: base) do |f|
      f.options.open_timeout = ENV.fetch("CV_SERVICE_OPEN_TIMEOUT", "5").to_i
      f.options.timeout = ENV.fetch("CV_SERVICE_PROGRESS_TIMEOUT", "10").to_i
      f.adapter Faraday.default_adapter
    end

    response = conn.get("/shards/#{shard_id}/processing_progress")
    return nil unless response.success?

    data = JSON.parse(response.body)
    return nil if data["status"].to_s == "idle"

    data
  rescue StandardError => e
    Rails.logger.debug("[CvShardProgress] shard_id=#{shard_id}: #{e.class}: #{e.message}")
    nil
  end

  def self.format_eta(seconds)
    return nil unless seconds.is_a?(Numeric) && seconds.finite?

    sec = seconds.to_f
    return "завершение…" if sec <= 0
    return "≈ #{sec.round} сек" if sec < 60
    return "≈ #{(sec / 60).round} мин" if sec < 3600

    "≈ #{(sec / 3600).round(1)} ч"
  end

  def self.status_message(progress)
    return nil unless progress.is_a?(Hash)

    processed = progress["processed_frames"]
    total = progress["frames_to_process"]
    interval = progress["frame_interval"]
    eta = format_eta(progress["eta_seconds"])

    parts = []
    if processed.is_a?(Numeric) && total.is_a?(Numeric) && total.positive?
      parts << "Кадры #{processed.to_i}/#{total.to_i}"
    end
    parts << "интервал #{interval}" if interval.is_a?(Numeric) && interval > 1
    parts << "осталось #{eta}" if eta.present?

    parts.presence&.join(", ")
  end
end
