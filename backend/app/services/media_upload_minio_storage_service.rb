# frozen_string_literal: true

# Загружает прикреплённый media_file в MinIO и обновляет url / upload_meta (source_key).
class MediaUploadMinioStorageService
  def initialize(media_upload)
    @media_upload = media_upload
  end

  def ensure_uploaded!
    return if object_key.present?

    blob = @media_upload.media_file.blob
    raise ArgumentError, "Нет прикреплённого файла" unless blob

    session_id = @media_upload.upload_session_id.presence || SecureRandom.hex(16)
    ext = File.extname(blob.filename.to_s).downcase
    ext = ".mp4" if ext.blank?
    dest_filename = "mission_#{@media_upload.mission_id}_upload_#{session_id}#{ext}"
    key = "missions/#{@media_upload.mission_id}/uploads/#{session_id}/#{dest_filename.gsub(/[^\w.\-]/, '_')}"

    service = S3MultipartUploadService.new
    blob.open do |file|
      raise ArgumentError, "Файл имеет нулевой размер" if File.size(file.path).zero?

      service.upload_file(
        key: key,
        path: file.path,
        content_type: blob.content_type.presence || "video/mp4"
      )
    end

    public_url = service.object_public_url(key)
    meta = (@media_upload.upload_meta || {}).merge(
      "storage" => "s3",
      "key" => key,
      "source_key" => key,
      "mp4_key" => key,
      "source_url" => public_url,
      "content_type" => blob.content_type,
      "byte_size" => blob.byte_size
    )

    @media_upload.update!(
      url: public_url,
      upload_session_id: session_id,
      upload_meta: meta
    )

    Rails.logger.info(
      "[MediaUploadMinioStorage] media_upload_id=#{@media_upload.id} key=#{key}"
    )
    key
  end

  def object_key
    meta = @media_upload.upload_meta || {}
    meta["mp4_key"].to_s.presence || meta["source_key"].to_s.presence || meta["key"].to_s.presence
  end
end
