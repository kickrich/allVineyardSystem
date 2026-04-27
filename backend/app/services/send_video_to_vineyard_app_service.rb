require 'faraday'
require 'faraday/multipart'
require 'uri'
require 'json'

# Сервис для отправки видео из Backend в VineyardApp
# Используется после завершения загрузки видео (MediaUpload)
class SendVideoToVineyardAppService
  RETRYABLE_HTTP_STATUSES = [404, 408, 425, 429, 500, 502, 503, 504].freeze

  attr_reader :last_error_message

  def initialize(media_upload)
    @media_upload = media_upload
    @mission = media_upload.mission
    @vineyard_app_url = ENV.fetch('VINEYARD_APP_URL', 'http://localhost:3000')
    @last_error_message = nil
  end

  # Отправить видео в VineyardApp
  # Возвращает video_id или nil в случае ошибки
  def send
    return nil unless can_send?

    upload_shards
    sync_mission_video_id_from_last_response!

    @mission.reload.vineyard_app_video_id
  rescue => e
    @last_error_message = e.message.to_s.truncate(2000)
    Rails.logger.error("[SendVideoToVineyardAppService] Error: #{@last_error_message}")
    Rails.logger.error(e.backtrace.join("\n"))
    nil
  end

  private

  def can_send?
    return false unless @media_upload.status == 'ready'
    return false unless @mission.present?
    return false unless @media_upload.media_file.attached? || @media_upload.url.present?

    true
  end

  def video_name
    "Миссия ##{@mission.id} - #{@mission.drone&.name} - #{@media_upload.created_at&.strftime('%Y-%m-%d %H:%M')}"
  end

  def backend_callback_base_url
    port = ENV.fetch('PORT', '3001')
    ENV.fetch('BACKEND_PUBLIC_URL', "http://localhost:#{port}")
  end

  # Предпочитаем MinIO (object_key + url), чтобы не тянуть большой файл через Backend.
  def upload_shards
    if minio_payload_available?
      @last_shard_response = upload_shard_with_url
    elsif @media_upload.media_file.attached?
      @last_shard_response = upload_shard_with_file
    elsif @media_upload.url.present?
      @last_shard_response = upload_shard_with_url
    else
      raise "Нет ни файла, ни URL для отправки в VineyardApp"
    end
  end

  def minio_payload_available?
    minio_object_key.present? && @media_upload.url.present?
  end

  def computed_shard_index
    ids = @mission.media_uploads.where(media_type: 'video').order(:id).pluck(:id)
    idx = ids.index(@media_upload.id)
    (idx.nil? ? ids.size - 1 : idx) + 1
  end

  def shard_request_body_common
    {
      mission_id: @mission.id,
      video_id: @mission.vineyard_app_video_id,
      shard_index: computed_shard_index,
      name: video_name,
      callback_token: @mission.vineyard_app_callback_token,
      external_service_url: backend_callback_base_url
    }.compact
  end

  def parse_shard_response(response)
    return nil unless response&.body.present?
    JSON.parse(response.body)
  rescue JSON::ParserError
    nil
  end

  def sync_mission_video_id_from_last_response!
    data = parse_shard_response(@last_shard_response)
    vid = data['video_id'] || data[:video_id]
    return if vid.blank?

    @mission.update!(vineyard_app_video_id: vid) if @mission.vineyard_app_video_id != vid
  end

  def upload_shard_with_file
    blob = @media_upload.media_file.blob
    temp_file = Tempfile.new(["media_#{@media_upload.id}".force_encoding('UTF-8'), '.mp4'])
    temp_file.binmode

    blob.open do |file|
      IO.copy_stream(file, temp_file)
    end

    temp_file.rewind

    if File.size(temp_file.path).zero?
      raise "Скачанный файл имеет нулевой размер"
    end

    conn = Faraday.new(url: @vineyard_app_url) do |faraday|
      faraday.request :multipart
      faraday.request :url_encoded
      faraday.adapter Faraday.default_adapter
      faraday.options.timeout = vineyard_upload_timeout_seconds
    end

    body = shard_request_body_common.merge(
      video: Faraday::UploadIO.new(temp_file.path, 'video/mp4', 'video.mp4')
    )

    response = with_upload_retry("file") do
      conn.post("/api/missions/upload_shard") do |req|
        req.body = body
      end
    end

    response
  ensure
    temp_file&.close
    temp_file&.unlink
  end

  def upload_shard_with_url
    Rails.logger.info("[SendVideoToVineyardAppService] MinIO / URL mode media_upload_id=#{@media_upload.id}")

    conn = Faraday.new(url: @vineyard_app_url) do |faraday|
      faraday.request :json
      faraday.adapter Faraday.default_adapter
      faraday.options.timeout = vineyard_upload_timeout_seconds
    end

    object_key = minio_object_key
    bucket = ENV['S3_BUCKET'].to_s.presence

    body = shard_request_body_common.merge(
      object_key: object_key.presence,
      bucket: bucket,
      video_url: @media_upload.url
    ).compact

    response = with_upload_retry("url") do
      conn.post("/api/missions/upload_shard") do |req|
        req.body = body
      end
    end

    response
  end

  def with_upload_retry(mode)
    attempts = [vineyard_upload_retry_attempts, 1].max
    n = 0
    begin
      n += 1
      response = yield
      if !response.status.in?(200..299)
        body = response.body.to_s.truncate(400)
        message = "VineyardApp upload_shard failed (#{mode}): #{response.status} - #{body}"
        if RETRYABLE_HTTP_STATUSES.include?(response.status)
          raise Faraday::ClientError.new(message, response: response)
        end
        raise message
      end
      response
    rescue Faraday::TimeoutError, Faraday::ConnectionFailed, Faraday::SSLError, Faraday::ClientError => e
      raise if n >= attempts
      delay = vineyard_upload_retry_delay_seconds * (2**(n - 1))
      Rails.logger.warn(
        "[SendVideoToVineyardAppService] upload retry #{n}/#{attempts - 1} " \
        "media_upload_id=#{@media_upload.id} mode=#{mode} err=#{e.class}: #{e.message}"
      )
      sleep(delay)
      retry
    end
  end

  def vineyard_upload_timeout_seconds
    raw = ENV["VINEYARD_APP_UPLOAD_TIMEOUT_SECONDS"].to_s.strip
    value = raw.empty? ? 600 : raw.to_i
    value = 600 if value < 1
    value.clamp(30, 86_400)
  end

  def vineyard_upload_retry_attempts
    raw = ENV["VINEYARD_APP_UPLOAD_RETRY_ATTEMPTS"].to_s.strip
    value = raw.empty? ? 4 : raw.to_i
    value = 4 if value < 1
    value.clamp(1, 10)
  end

  def vineyard_upload_retry_delay_seconds
    raw = ENV["VINEYARD_APP_UPLOAD_RETRY_DELAY_SECONDS"].to_s.strip
    value = raw.empty? ? 3 : raw.to_i
    value = 3 if value < 1
    value.clamp(1, 60)
  end

  def minio_object_key
    meta = @media_upload.upload_meta || {}
    key = meta['mp4_key'].to_s.presence || meta['source_key'].to_s.presence
    return key if key.present?

    url = @media_upload.url.to_s
    uri = URI.parse(url)
    segments = uri.path.to_s.split('/').reject(&:blank?)
    return '' if segments.size < 2

    segments[1..].join('/')
  rescue URI::InvalidURIError
    ''
  end
end
