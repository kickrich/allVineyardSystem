require 'faraday'
require 'faraday/multipart'
require 'uri'
require 'json'
require 'cgi'

# Сервис для отправки видео из Backend в VineyardApp
# Используется после завершения загрузки видео (MediaUpload)
class SendVideoToVineyardAppService
  def initialize(media_upload)
    @media_upload = media_upload
    @mission = media_upload.mission
    @vineyard_app_url = ENV.fetch('VINEYARD_APP_URL', 'http://localhost:3000')
  end

  # Отправить видео в VineyardApp
  # Возвращает video_id или nil в случае ошибки
  def send
    return nil unless can_send?

    upload_shards
    sync_mission_video_id_from_last_response!

    @mission.reload.vineyard_app_video_id
  rescue => e
    Rails.logger.error("[SendVideoToVineyardAppService] Error: #{e.message}")
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
      faraday.options.timeout = 600
    end

    body = shard_request_body_common.merge(
      video: Faraday::UploadIO.new(temp_file.path, 'video/mp4', 'video.mp4')
    )

    response = conn.post("/api/missions/upload_shard") do |req|
      req.body = body
    end

    unless response.status.in?(200..299)
      raise "Failed to upload shard: #{response.status} - #{response.body}"
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
      faraday.options.timeout = 120
    end

    object_key = minio_object_key
    bucket = ENV['S3_BUCKET'].to_s.presence

    body = shard_request_body_common.merge(
      object_key: object_key.presence,
      bucket: bucket,
      video_url: @media_upload.url
    ).compact

    response = conn.post("/api/missions/upload_shard") do |req|
      req.body = body
    end

    unless response.status.in?(200..299)
      raise "VineyardApp upload_shard failed: #{response.status} - #{response.body}"
    end

    response
  end

  def minio_object_key
    meta = @media_upload.upload_meta || {}
    key = meta['mp4_key'].to_s.presence || meta['source_key'].to_s.presence
    return key if key.present?

    url = @media_upload.url.to_s
    uri = URI.parse(url)
    segments = uri.path.to_s.split('/').reject(&:blank?)
    return '' if segments.size < 2

    CGI.unescape(segments[1..].join('/'))
  rescue URI::InvalidURIError
    ''
  end
end
