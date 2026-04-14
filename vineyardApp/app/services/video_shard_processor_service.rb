require "faraday"
require "faraday/multipart"
require "aws-sdk-s3"
require "securerandom"
require "uri"
require "json"

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
    source = source_payload_from_shard
    object_key = source[:object_key]
    bucket = source[:bucket]

    if object_key.blank? && @shard.video_file.attached?
      object_key = upload_blob_to_minio(@shard.video_file.blob)
      bucket = ENV.fetch('MINIO_BUCKET')
    end

    if object_key.blank?
      raise "Не найден object_key для обработки (и нет прикрепленного файла)"
    end

    conn = Faraday.new(url: @cv_service_url) do |faraday|
      faraday.request :json
      faraday.adapter Faraday.default_adapter
      faraday.options.timeout = 600
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
      req.body = payload
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

  def upload_blob_to_minio(blob)
    s3 = Aws::S3::Client.new(
      endpoint: ENV.fetch('MINIO_ENDPOINT'),
      region: ENV.fetch('MINIO_REGION', 'us-east-1'),
      access_key_id: ENV.fetch('MINIO_ACCESS_KEY'),
      secret_access_key: ENV.fetch('MINIO_SECRET_KEY'),
      force_path_style: true
    )

    bucket = ENV.fetch('MINIO_BUCKET')
    ensure_bucket!(s3, bucket)
    object_key = "video-shards/#{@shard.video_id}/#{@shard.id}/#{SecureRandom.uuid}-#{blob.filename}"

    blob.open do |file|
      file_size = File.size(file.path)
      if file_size == 0
        raise "Скачанный файл имеет нулевой размер"
      end

      s3.put_object(
        bucket: bucket,
        key: object_key,
        body: file,
        content_type: blob.content_type || 'video/mp4'
      )
    end

    object_key
  rescue Aws::S3::Errors::ServiceError => e
    raise "Ошибка загрузки в MinIO: #{e.message}"
  rescue KeyError => e
    raise "Не задана переменная окружения: #{e.message}"
  rescue => e
    raise
  ensure
    # Здесь intentionally no-op: blob.open сам закрывает временный файл
  end

  def ensure_bucket!(s3, bucket)
    s3.head_bucket(bucket: bucket)
  rescue Aws::S3::Errors::NotFound, Aws::S3::Errors::NoSuchBucket
    s3.create_bucket(bucket: bucket)
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
      bush_spacing_avg: p["bush_spacing_avg"],
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

  def source_payload_from_shard
    source = (@shard.result_json || {})['source'] || {}
    object_key = source['object_key'].to_s.presence
    bucket = source['bucket'].to_s.presence
    video_url = source['video_url'].to_s.presence

    if object_key.blank? && video_url.present?
      parsed_bucket, parsed_key = parse_key_from_url(video_url)
      object_key = parsed_key if parsed_key.present?
      bucket = parsed_bucket if bucket.blank? && parsed_bucket.present?
    end

    bucket ||= ENV['MINIO_BUCKET'].to_s.presence

    {
      object_key: object_key,
      bucket: bucket
    }
  end

  def parse_key_from_url(video_url)
    uri = URI.parse(video_url)
    segments = uri.path.to_s.split('/').reject(&:blank?)
    return [nil, nil] if segments.size < 2

    bucket = segments.first
    key = segments[1..].join('/')
    [bucket, key]
  rescue URI::InvalidURIError
    [nil, nil]
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
      faraday.options.timeout = 600
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