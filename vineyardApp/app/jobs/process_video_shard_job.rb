class ProcessVideoShardJob < ApplicationJob
  include ActiveJob::Status
  
  queue_as :default

  def perform(shard_id)
    shard = VideoShard.find(shard_id)
    shard.update_columns(
      status: VideoShard.statuses[:processing],
      job_id: self.job_id
    )

    service = VideoShardProcessorService.new(shard)
    result = service.process

    if result[:success]
      Rails.logger.info("[ProcessVideoShardJob] shard_id=#{shard_id} ok")
    else
      # статус error уже выставлен в VideoShardProcessorService#process
      Rails.logger.warn("[ProcessVideoShardJob] shard_id=#{shard_id} service error: #{result[:error]}")
    end
  rescue => e
    Rails.logger.error("[ProcessVideoShardJob] shard_id=#{shard_id}: #{e.class}: #{e.message}")
    shard&.update_column(:status, VideoShard.statuses[:error]) if shard&.persisted?
  end
end