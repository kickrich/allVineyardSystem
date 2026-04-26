class AiResult < ApplicationRecord
  belongs_to :mission

  validates :bushes_count, numericality: { greater_than_or_equal_to: 0 }, allow_nil: true, if: ->(record) { record.has_attribute?(:bushes_count) }
  validates :gaps_count, numericality: { greater_than_or_equal_to: 0 }, allow_nil: true, if: ->(record) { record.has_attribute?(:gaps_count) }
  validates :avg_bush_spacing, numericality: { greater_than_or_equal_to: 0 }, allow_nil: true, if: ->(record) { record.has_attribute?(:avg_bush_spacing) }

  def bushes_positions
    result_json&.dig('bushes_positions') || []
  end

  def gaps_positions
    result_json&.dig('gaps_positions') || []
  end

  def gaps_count
    return self[:gaps_count] if has_attribute?(:gaps_count)

    (result_json&.dig('total_gaps') || result_json&.dig('gaps_count') || 0).to_i
  end

  def avg_bush_spacing
    return self[:avg_bush_spacing] if has_attribute?(:avg_bush_spacing)

    (result_json&.dig('avg_bush_spacing') || 0).to_f
  end
end
