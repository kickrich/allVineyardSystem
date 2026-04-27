class AiResult < ApplicationRecord
  belongs_to :mission

  validates :bushes_count, :gaps_count, numericality: { greater_than_or_equal_to: 0 }, allow_nil: true
  validates :avg_bush_spacing, numericality: { greater_than_or_equal_to: 0 }, allow_nil: true

  # Backward-compatible virtual attribute kept in result_json.
  def gaps_count
    result_json&.dig("gaps_count")
  end

  def gaps_count=(value)
    merged = (result_json || {}).merge("gaps_count" => value)
    self.result_json = merged
  end

  # Legacy alias for the renamed DB column.
  def avg_bush_spacing
    self[:avg_distance_between_bushes]
  end

  def avg_bush_spacing=(value)
    self[:avg_distance_between_bushes] = value
  end

  def bushes_positions
    result_json&.dig('bushes_positions') || []
  end

  def gaps_positions
    result_json&.dig('gaps_positions') || []
  end
end
