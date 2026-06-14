require "faraday"
require "faraday/multipart"
require "uri"
require "json"
require "cgi"

class VideoShardProcessorService
  def initialize(shard)
    @shard = shard
    @cv_service_url = ENV.fetch('CV_SERVICE_URL', 'http://localhost:8000')
  end

  def process
    send_to_cv_service
    { success: true, message: "Отправлено на обработку" }
  rescue => e
    Rails.logger.error("[VideoShardProcessor] shard_id=#{@shard.id} video_id=#{@shard.video_id}: #{e.class}: #{e.message}")
    Rails.logger.debug(e.backtrace&.first(20)&.join("\n"))

    merged = (@shard.result_json || {}).dup
    merged["last_error"] = {
      "class" => e.class.name,
      "message" => e.message,
      "at" => Time.current.iso8601(3)
    }
    begin
      @shard.update_columns(
        status: VideoShard.statuses[:error],
        result_json: merged
      )
    rescue StandardError => persist_err
      Rails.logger.error("[VideoShardProcessor] не удалось записать last_error: #{persist_err.message}")
      @shard.update_column(:status, VideoShard.statuses[:error]) rescue nil
    end

    { success: false, error: e.message }
  end

  private

  def send_to_cv_service
    storage = VideoShardMinioStorageService.new(@shard)
    source = storage.current_source
    object_key = source[:object_key]
    bucket = source[:bucket]

    if object_key.blank? && @shard.video_file.attached?
      source = storage.ensure_uploaded!
      object_key = source[:object_key]
      bucket = source[:bucket]
    end

    if object_key.blank?
      raise "Не найден object_key для обработки (и нет прикреплённого файла)"
    end

    conn = Faraday.new(url: @cv_service_url) do |faraday|
      faraday.adapter Faraday.default_adapter
      faraday.options.open_timeout = cv_service_open_timeout
      faraday.options.timeout = cv_service_read_timeout
    end

    callback_host = ENV.fetch("RAILS_URL", "http://localhost:3000")
    callback_url = "#{callback_host}/api/video_shards/#{@shard.id}/results"

    payload = {
      shard_id: @shard.id,
      object_key: object_key,
      callback_url: callback_url,
      frame_interval: 4
    }
    payload[:bucket] = bucket if bucket.present?

    response = conn.post("/process_video_shard_from_minio") do |req|
      req.headers["Content-Type"] = "application/json"
      req.body = JSON.generate(payload)
    end

    parsed =
      begin
        JSON.parse(response.body)
      rescue JSON::ParserError
        {}
      end

    unless response.success?
      detail = parsed["detail"] || parsed["message"] || response.body.to_s.truncate(2000)
      raise "CV service #{response.status}: #{detail}"
    end

    apply_cv_result_from_response!(parsed) if parsed.is_a?(Hash)

    response
  end

  # cvService отдаёт те же поля, что и колбэк /api/video_shards/:id/results (если колбэк из Docker не дошёл до localhost).
  def apply_cv_result_from_response!(parsed)
    p = parsed.stringify_keys
    return unless p["status"].to_s == "success"
    return unless p.key?("bushes_count") || p.key?("result_json")

    result_json = p["result_json"]
    result_json = {} if result_json.blank?

    @shard.update_columns(
      bushes_count: p["bushes_count"],
      gaps_count: p["gaps_count"],
      result_json: result_json,
      recorded_at: Time.current,
      status: VideoShard.statuses[:completed],
      updated_at: Time.current
    )
    @shard.video.recalculate_status!

    Rails.logger.info(
      "[VideoShardProcessor] shard_id=#{@shard.id} saved from CV response " \
      "(callback_delivered=#{p['callback_delivered']})"
    )
  end

  def cv_service_read_timeout
    ENV.fetch('CV_SERVICE_READ_TIMEOUT', '14400').to_i
  end

  def cv_service_open_timeout
    ENV.fetch('CV_SERVICE_OPEN_TIMEOUT', '60').to_i
  end

  def source_payload_from_shard
    VideoShardMinioStorageService.new(@shard).current_source
  end

  def send_to_cv_service_legacy
    blob = @shard.video_file.blob

    temp_file = Tempfile.new(["shard_#{@shard.id}".force_encoding('UTF-8'), '.mp4'])
    temp_file.binmode

    blob.open do |file|
      IO.copy_stream(file, temp_file)
    end

    temp_file.rewind

    file_size = File.size(temp_file.path)

    if file_size == 0
      raise "Скачанный файл имеет нулевой размер"
    end

    conn = Faraday.new(url: @cv_service_url) do |faraday|
      faraday.request :multipart
      faraday.request :url_encoded
      faraday.adapter Faraday.default_adapter
      faraday.options.open_timeout = cv_service_open_timeout
      faraday.options.timeout = cv_service_read_timeout
    end

    callback_host = ENV.fetch('RAILS_URL', 'http://localhost:3000')
    callback_url = "#{callback_host}/api/video_shards/#{@shard.id}/results"

    payload = {
      shard_id: @shard.id.to_s,
      video_file: Faraday::UploadIO.new(temp_file.path, 'video/mp4', 'video.mp4'),
      callback_url: callback_url
    }

    response = conn.post('/process_video_shard') do |req|
      req.body = payload
    end

    response
  rescue => e
    raise
  ensure
    temp_file.close if temp_file
    temp_file.unlink if temp_file
  end
end