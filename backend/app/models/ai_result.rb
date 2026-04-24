class AiResult < ApplicationRecord
  belongs_to :mission

  validates :bushes_count, :gaps_count, numericality: { greater_than_or_equal_to: 0 }, allow_nil: true
  validates :avg_bush_spacing, numericality: { greater_than_or_equal_to: 0 }, allow_nil: true

  def bushes_positions
    result_json&.dig('bushes_positions') || []
  end

  def gaps_positions
    result_json&.dig('gaps_positions') || []
  end
end
