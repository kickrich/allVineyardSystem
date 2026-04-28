class AiResult < ApplicationRecord
  belongs_to :mission

  validates :bushes_count, :gaps_count, numericality: { greater_than_or_equal_to: 0 }, allow_nil: true

  # Backward-compatible virtual attribute kept in result_json.
  def gaps_count
    result_json&.dig("gaps_count")
  end

  def gaps_count=(value)
    merged = (result_json || {}).merge("gaps_count" => value)
    self.result_json = merged
  end

  def bushes_positions
    result_json&.dig('bushes_positions') || []
  end

  def gaps_positions
    result_json&.dig('gaps_positions') || []
  end
end
