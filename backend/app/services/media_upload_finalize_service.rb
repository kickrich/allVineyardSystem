# frozen_string_literal: true

# Помечает видео в MinIO готовым к отправке в vineyardApp без перекодирования.
# Допустимые типы — те же, что при загрузке (MediaUpload::ALLOWED_VIDEO_CONTENT_TYPES).
class MediaUploadFinalizeService
  def initialize(media_upload)
    @media_upload = media_upload
  end

  def call
    meta = @media_upload.upload_meta || {}
    source_key = meta["source_key"].to_s.presence || meta["key"].to_s
    raise ArgumentError, "Не задан ключ объекта в MinIO" if source_key.blank?

    content_type = meta["content_type"].to_s
    unless allowed_video?(content_type, source_key)
      raise ArgumentError, "Неподдерживаемый формат видео (допустимы mp4 и webm)"
    end

    service = S3MultipartUploadService.new
    source_url = meta["source_url"].to_s.presence || service.object_public_url(source_key)
    next_meta = meta.merge(
      "source_key" => source_key,
      "source_url" => source_url,
      "mp4_key" => source_key
    )

    @media_upload.update!(
      status: "ready",
      url: source_url,
      upload_meta: next_meta,
      error_message: nil
    )

    @media_upload
  end

  private

  def allowed_video?(content_type, source_key)
    return true if MediaUpload::ALLOWED_VIDEO_CONTENT_TYPES.include?(content_type)

    %w[.mp4 .webm].include?(File.extname(source_key).downcase)
  end
end
