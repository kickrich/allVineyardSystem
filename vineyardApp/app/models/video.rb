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

  def avg_bush_spacing
    spacings = video_shards.where.not(bush_spacing_avg: nil).pluck(:bush_spacing_avg)
    spacings.any? ? spacings.sum / spacings.size : 0.0
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

    status_changed = status != new_status.to_s
    update!(status: new_status) if status_changed

    if status_changed && new_status.to_s == 'completed' && external_service?
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
      name: name,
      status: status,
      processing_progress: processing_progress,
      shards_count: video_shards.count,
      processed_shards: video_shards.where(status: :completed).count,
      statistics: {
        total_bushes: total_bushes_count,
        total_gaps: total_gaps_count,
        avg_bush_spacing: avg_bush_spacing,
        bushes_positions: all_bushes_positions,
        gaps_positions: all_gaps_positions,
        rows_schema: rows_schema
      },
      created_at: created_at,
      updated_at: updated_at
    }
  end

  def external_service?
    external_service_url.present?
  end

  def rows_schema
    video_shards.order(:shard_index).map do |shard|
      {
        shard_index: shard.shard_index,
        bushes_count: shard.bushes_count,
        gaps_count: shard.gaps_count,
        row_sequence: shard.result_json&.dig('row_sequence') || [],
        row_length: shard.result_json&.dig('row_length')
      }
    end
  end
end