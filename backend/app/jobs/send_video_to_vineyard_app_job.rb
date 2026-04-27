class SendVideoToVineyardAppJob < ApplicationJob
  queue_as :default

  def perform(media_upload_id)
    media_upload = MediaUpload.find(media_upload_id)

    Rails.logger.info("[SendVideoToVineyardAppJob] Starting for media_upload_id=#{media_upload_id}")

    service = SendVideoToVineyardAppService.new(media_upload)
    video_id = service.send

    if video_id
      media_upload.update!(status: 'sent_to_vineyard', error_message: nil)
      Rails.logger.info("[SendVideoToVineyardAppJob] Completed, video_id=#{video_id}")
    else
      fail_reason = service.last_error_message.presence || "Не удалось отправить видео в VineyardApp"
      media_upload.update!(status: 'failed', error_message: fail_reason)
      Rails.logger.error("[SendVideoToVineyardAppJob] Failed for media_upload_id=#{media_upload_id}: #{fail_reason}")
    end
  rescue => e
    Rails.logger.error("[SendVideoToVineyardAppJob] Error: #{e.message}")
    Rails.logger.error(e.backtrace.join("\n"))
    raise
  end
end
