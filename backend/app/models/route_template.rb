class RouteTemplate < ApplicationRecord
  belongs_to :user
  belongs_to :zone, optional: true

  before_validation :strip_name
  before_validation :normalize_shift_segment_indices

  validates :name, presence: { message: "не может быть пустым" },
                   length: { minimum: 2, maximum: 120, message: "должно быть от 2 до 120 символов" }
  validate :path_valid
  validate :shift_segment_indices_valid

  scope :ordered_recent, -> { order(created_at: :desc, id: :desc) }

  private

  def strip_name
    self.name = name.to_s.strip.presence if name.present?
  end

  def path_valid
    return errors.add(:path, "должен быть массивом") unless path.is_a?(Array)
    return errors.add(:path, "должен содержать минимум 2 точки") if path.length < 2

    path.each_with_index do |point, i|
      unless point.is_a?(Array) && point.length == 2
        errors.add(:path, "точка #{i + 1} должна быть массивом [lat, lng]")
        break
      end

      lat, lng = point
      unless lat.is_a?(Numeric) && lng.is_a?(Numeric)
        errors.add(:path, "точка #{i + 1} должна содержать числовые координаты")
        break
      end

      unless (-90.0..90.0).cover?(lat) && (-180.0..180.0).cover?(lng)
        errors.add(:path, "точка #{i + 1} вне диапазонов широты/долготы")
        break
      end
    end
  end

  def normalize_shift_segment_indices
    return unless has_attribute?(:shift_segment_indices)

    raw = shift_segment_indices
    normalized = Array(raw).map { |v| Integer(v, exception: false) }.compact
    normalized = normalized.select { |i| i >= 0 }.uniq.sort
    self.shift_segment_indices = normalized
  end

  def shift_segment_indices_valid
    return unless has_attribute?(:shift_segment_indices)
    return unless shift_segment_indices.present?
    return errors.add(:shift_segment_indices, "должен быть массивом целых чисел") unless shift_segment_indices.is_a?(Array)

    max_segment_index = path.is_a?(Array) && path.length >= 2 ? path.length - 2 : -1
    shift_segment_indices.each do |idx|
      unless idx.is_a?(Integer)
        errors.add(:shift_segment_indices, "должен содержать только целые числа")
        break
      end
      if idx < 0 || idx > max_segment_index
        errors.add(:shift_segment_indices, "содержит индекс вне диапазона маршрута")
        break
      end
    end
  end
end
