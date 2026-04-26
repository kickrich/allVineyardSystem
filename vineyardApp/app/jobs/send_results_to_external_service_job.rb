class SendResultsToExternalServiceJob < ApplicationJob
  queue_as :default

  def perform(video_id)
    video = Video.find(video_id)
    
    return unless video.external_service?
    return unless video.status == 'completed'

    service = SendResultsToExternalServiceService.new(video)
    service.send_results
  rescue => e
    Rails.logger.error("[SendResultsToExternalServiceJob] video_id=#{video_id}: #{e.class}: #{e.message}")
    Rails.logger.debug(e.backtrace&.first(20)&.join("\n"))
  end
end
