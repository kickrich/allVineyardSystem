class Drone < ApplicationRecord
  STATUSES = %w[idle in_mission charging offline].freeze

  # При удалении дрона удаляем связанные миссии и их дочерние записи (маршруты, телеметрия и т.д.).
  has_many :missions, dependent: :destroy

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

end
