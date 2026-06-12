class SendVideoToVineyardAppJob < ApplicationJob
  queue_as :default

  def perform(media_upload_id)
    media_upload = MediaUpload.find(media_upload_id)

    if media_upload.status == "sent_to_vineyard"
      Rails.logger.info("[SendVideoToVineyardAppJob] Already sent, skip media_upload_id=#{media_upload_id}")
      return
    end

    unless media_upload.status == "ready"
      Rails.logger.warn(
        "[SendVideoToVineyardAppJob] Status=#{media_upload.status}, skip media_upload_id=#{media_upload_id}"
      )
      return
    end

    video_id = nil
    fail_reason = nil

    media_upload.with_lock do
      media_upload.reload
      if media_upload.status == "sent_to_vineyard"
        Rails.logger.info("[SendVideoToVineyardAppJob] Already sent (locked), skip media_upload_id=#{media_upload_id}")
        return
      end
      unless media_upload.status == "ready"
        Rails.logger.warn(
          "[SendVideoToVineyardAppJob] Status=#{media_upload.status} (locked), skip media_upload_id=#{media_upload_id}"
        )
        return
      end

      Rails.logger.info("[SendVideoToVineyardAppJob] Starting for media_upload_id=#{media_upload_id}")
      service = SendVideoToVineyardAppService.new(media_upload)
      video_id = service.send
      fail_reason = service.last_error_message

      if video_id
        media_upload.update!(status: "sent_to_vineyard", error_message: nil)
      else
        media_upload.update!(
          status: "failed",
          error_message: fail_reason.presence || "Не удалось отправить видео в VineyardApp"
        )
      end
    end

    if video_id
      Rails.logger.info("[SendVideoToVineyardAppJob] Completed, video_id=#{video_id}")
    elsif fail_reason.present?
      Rails.logger.error("[SendVideoToVineyardAppJob] Failed for media_upload_id=#{media_upload_id}: #{fail_reason}")
    end
  rescue => e
    Rails.logger.error("[SendVideoToVineyardAppJob] Error: #{e.message}")
    Rails.logger.error(e.backtrace.join("\n"))
    raise
  end
end
