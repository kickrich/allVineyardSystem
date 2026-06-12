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
    unless VideoUploadFormats.allowed_video?(content_type: content_type, path: source_key)
      raise ArgumentError, "Неподдерживаемый формат видео (допустимы mp4, webm, mov, avi, mkv)"
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

end
