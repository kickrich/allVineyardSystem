class Telemetry < ApplicationRecord
  ACCEPTED_MISSION_STATUSES = %i[in_progress completed].freeze

  belongs_to :mission

  # Допустимые диапазоны для истории перемещений (1.5)
  ALTITUDE_RANGE = (0..1000).freeze
  BATTERY_RANGE = (0..100).freeze
  COORD_LAT_RANGE = (-90.0..90.0).freeze
  COORD_LNG_RANGE = (-180.0..180.0).freeze

  before_validation :set_recorded_at_default, on: :create

  validates :mission, presence: { message: "должна быть указана" }
  validates :recorded_at, presence: { message: "должно быть указано" }
  validates :latitude, numericality: {
    greater_than_or_equal_to: COORD_LAT_RANGE.begin,
    less_than_or_equal_to: COORD_LAT_RANGE.end,
    message: "должна быть от -90 до 90"
  }, allow_nil: true
  validates :longitude, numericality: {
    greater_than_or_equal_to: COORD_LNG_RANGE.begin,
    less_than_or_equal_to: COORD_LNG_RANGE.end,
    message: "должна быть от -180 до 180"
  }, allow_nil: true
  validates :altitude, numericality: {
    in: ALTITUDE_RANGE,
    message: "должна быть от 0 до 1000 м"
  }, allow_nil: true
  validates :battery, numericality: {
    only_integer: true,
    in: BATTERY_RANGE,
    message: "должна быть от 0 до 100%"
  }, allow_nil: true
  validates :speed, numericality: {
    greater_than_or_equal_to: 0,
    message: "не может быть отрицательной"
  }, allow_nil: true

  validate :mission_accepts_telemetry
  validate :recorded_at_not_in_future

  scope :for_mission, ->(mission_id) { where(mission_id: mission_id).order(recorded_at: :asc) }
  scope :ordered, -> { order(recorded_at: :asc) }

  private

  def set_recorded_at_default
    self.recorded_at = Time.current if recorded_at.blank?
  end

  def mission_accepts_telemetry
    return if mission.blank?
    return if ACCEPTED_MISSION_STATUSES.any? { |status| mission.public_send("#{status}?") }
    errors.add(:mission, "должна быть в статусе in_progress или completed для приёма телеметрии")
  end

  def recorded_at_not_in_future
    return if recorded_at.blank?
    return if recorded_at <= Time.current
    errors.add(:recorded_at, "не может быть в будущем")
  end
end
