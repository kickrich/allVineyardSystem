# frozen_string_literal: true

# Историческое имя job: раньше делал webm→mp4. Сейчас только finalize (без ffmpeg).
class MediaUploadTranscodeJob < ApplicationJob
  queue_as :default

  def perform(media_upload_id)
    media_upload = MediaUpload.find_by(id: media_upload_id)
    return if media_upload.nil?
    return if media_upload.status == "ready"

    MediaUploadFinalizeService.new(media_upload).call
  rescue S3MultipartUploadService::ConfigError => e
    MediaUpload.where(id: media_upload_id).update_all(status: "failed", error_message: e.message)
  rescue StandardError => e
    MediaUpload.where(id: media_upload_id).update_all(status: "failed", error_message: e.message)
  end
end
