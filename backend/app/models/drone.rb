class Drone < ApplicationRecord
  STATUSES = %w[idle in_mission charging offline].freeze

  # При удалении дрона удаляем связанные миссии и их дочерние записи (маршруты, телеметрия и т.д.).
  has_many :missions, dependent: :destroy
  has_many :drone_logs, dependent: :nullify

  enum :status, {
    idle: "idle",
    in_mission: "in_mission",
    charging: "charging",
    offline: "offline"
  }

  before_validation :strip_name_and_model
  before_validation :set_default_status, on: :create
  before_destroy :ensure_not_active

  # Валидации
  validates :name, presence: { message: "не может быть пустым" },
                   length: { minimum: 2, maximum: 100, message: "должно быть от 2 до 100 символов" }
  validates :model, presence: { message: "не может быть пустым" },
                    length: { minimum: 1, maximum: 100, message: "должна быть от 1 до 100 символов" }
  validates :status, presence: { message: "не может быть пустым" },
                     inclusion: { in: STATUSES, message: "должен быть: idle, in_mission, charging или offline" }
  validates :battery, numericality: {
    only_integer: true,
    greater_than_or_equal_to: 0,
    less_than_or_equal_to: 100,
    message: "должна быть от 0 до 100 процентов"
  }, allow_nil: true
  validates :latitude, numericality: { greater_than_or_equal_to: -90, less_than_or_equal_to: 90 }, allow_nil: true
  validates :longitude, numericality: { greater_than_or_equal_to: -180, less_than_or_equal_to: 180 }, allow_nil: true
  validate :route_path_has_valid_points
  validate :shift_segment_indices_valid

  scope :available, -> { where(status: [:idle, :charging]) }
  scope :by_status, ->(status) { where(status: status) }

  # Дрон можно назначить на миссию, только если он idle
  def available_for_mission?
    idle?
  end

  private

  # Убираем пробелы из имени и модели дрона
  def strip_name_and_model
    self.name = name.to_s.strip if name.present?
    self.model = model.to_s.strip if model.present?
  end

  # Устанавливаем статус idle по умолчанию
  def set_default_status
    self.status = self.class.statuses.fetch(:idle) if status.blank?
  end

  # Дрон нельзя удалить, если он в сети или на задании
  def ensure_not_active
    return if offline?
    errors.add(
      :base,
      I18n.t(
        "api.drones.errors.delete_only_offline",
        default: "Нельзя удалить дрон, пока он в сети или на задании. Сначала переведите его в offline."
      )
    )
    throw(:abort)
  end

  def route_path_has_valid_points
    return if route_path.blank?
    unless route_path.is_a?(Array)
      errors.add(:route_path, "должен быть массивом точек")
      return
    end

    route_path.each do |point|
      unless point.is_a?(Array) && point.length >= 2
        errors.add(:route_path, "содержит некорректную точку маршрута")
        next
      end
      lat = Float(point[0]) rescue nil
      lng = Float(point[1]) rescue nil
      unless lat && lng && lat.between?(-90, 90) && lng.between?(-180, 180)
        errors.add(:route_path, "содержит точку вне допустимого диапазона координат")
      end
    end
  end

  def shift_segment_indices_valid
    return if shift_segment_indices.blank?
    unless shift_segment_indices.is_a?(Array)
      errors.add(:shift_segment_indices, "должен быть массивом индексов")
      return
    end
    shift_segment_indices.each do |index|
      n = Integer(index) rescue nil
      errors.add(:shift_segment_indices, "содержит некорректный индекс") unless n && n >= 0
    end
  end

end
