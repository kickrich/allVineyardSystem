# app/models/zone.rb
class Zone < ApplicationRecord
  has_many :missions, dependent: :restrict_with_error
  has_one_attached :kml_file

  before_validation :strip_name_and_description

  validates :name, presence: { message: "не может быть пустым" },
                   length: { minimum: 2, maximum: 100, message: "должно быть от 2 до 100 символов" }
  validates :description, length: { maximum: 1000 }, allow_nil: true
  validate :boundary_valid

  scope :ordered_by_name, -> { order(:name) }

  # boundary: jsonb — массив точек [ [lng, lat], ... ] или []
  def boundary_valid
    return if boundary.nil?
    return errors.add(:boundary, "должен быть массивом") unless boundary.is_a?(Array)
    return errors.add(:boundary, "должен содержать минимум 4 точки") if boundary.size < 4
    return errors.add(:boundary, "полигон должен быть замкнут: первая и последняя точки должны совпадать") unless boundary.first == boundary.last

    boundary.each_with_index do |point, i|
      unless point.is_a?(Array) && point.size == 2 && point.all? { |v| v.is_a?(Numeric) }
        errors.add(:boundary, "точка #{i + 1} должна быть массивом [долгота, широта] с числами")
        break
      end

      lng, lat = point
      unless (-180.0..180.0).cover?(lng) && (-90.0..90.0).cover?(lat)
        errors.add(:boundary, "точка #{i + 1} должна быть в диапазонах: долгота -180..180, широта -90..90")
        break
      end
    end
  end

  private

  def strip_name_and_description
    self.name = name.to_s.strip.presence if name.present?
    self.description = description.to_s.strip.presence if description.present?
  end

end
