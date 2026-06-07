class Video < ApplicationRecord
  has_many :video_shards, dependent: :destroy
  has_one_attached :video_file
  has_one :detection, dependent: :destroy

  enum :status, {
    uploading: 0,
    processing: 1,
    completed: 2,
    error: 3
  }

  def total_bushes_count
    video_shards.sum(:bushes_count)
  end

  def total_gaps_count
    video_shards.sum(:gaps_count)
  end

  def all_bushes_positions
    video_shards.flat_map { |s| s.result_json&.dig('bushes_positions') }.compact
  end

  def all_gaps_positions
    video_shards.flat_map { |s| s.result_json&.dig('gaps_positions') }.compact
  end

  def processing_progress
    total = video_shards.count
    completed = video_shards.where(status: :completed).count
    total.zero? ? 0 : (completed.to_f / total * 100).round
  end

  def recalculate_status!
    if video_shards.exists?(status: :error)
      new_status = :error
    elsif video_shards.exists?(status: [:pending, :processing])
      new_status = :processing
    elsif video_shards.exists? && video_shards.where.not(status: :completed).empty?
      new_status = :completed
    else
      new_status = :uploading
    end

    previous_status = status
    if status != new_status.to_s
      update!(status: new_status)
    end

    # update_columns in shard processor bypasses shard callbacks,
    # so we trigger external callback on completed transition here.
    if previous_status != "completed" && new_status.to_s == "completed" && external_service?
      SendResultsToExternalServiceJob.perform_later(id)
    end
  end

  def next_available_shard_index
    existing_indices = video_shards.pluck(:shard_index).sort
    return 1 if existing_indices.empty?
    
    (1..existing_indices.last + 1).each do |i|
      return i unless existing_indices.include?(i)
    end
  end

  def aggregated_results
    {
      video_id: id,
      mission_id: mission_id,
      row_index: row_index,
      rows_count: rows_count,
      name: name,
      status: status,
      processing_progress: processing_progress,
      shards_count: video_shards.count,
      processed_shards: video_shards.where(status: :completed).count,
      shards: video_shards.order(:shard_index).map do |shard|
        {
          id: shard.id,
          shard_index: shard.shard_index,
          status: shard.status,
          bushes_count: shard.bushes_count,
          gaps_count: shard.gaps_count,
          row_sequence: shard.row_sequence
        }
      end,
      statistics: {
        total_bushes: total_bushes_count,
        total_gaps: total_gaps_count,
        bushes_positions: all_bushes_positions,
        gaps_positions: all_gaps_positions
      },
      created_at: created_at,
      updated_at: updated_at
    }
  end

  def external_service?
    external_service_url.present?
  end
end