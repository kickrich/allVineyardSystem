class Route < ApplicationRecord
  ALLOWED_MISSION_STATUSES_FOR_ROUTE = %i[planned approved].freeze

  belongs_to :mission

  # Ограничения высоты (метры)
  MIN_ALTITUDE = 2
  MAX_ALTITUDE = 5
  COORD_LAT_RANGE = (-90.0..90.0).freeze
  COORD_LNG_RANGE = (-180.0..180.0).freeze

  before_validation :set_max_altitude_if_blank

  # Валидации
  validates :mission, presence: { message: "должна быть указана" }
  validates :latitude, presence: { message: "обязательна для точки маршрута" },
                       numericality: { greater_than_or_equal_to: COORD_LAT_RANGE.begin, less_than_or_equal_to: COORD_LAT_RANGE.end },
                       allow_nil: true
  validates :longitude, presence: { message: "обязательна для точки маршрута" },
                        numericality: { greater_than_or_equal_to: COORD_LNG_RANGE.begin, less_than_or_equal_to: COORD_LNG_RANGE.end },
                        allow_nil: true
  validates :altitude, numericality: {
    greater_than_or_equal_to: MIN_ALTITUDE,
    less_than_or_equal_to: ->(r) { r.max_altitude || MAX_ALTITUDE },
    message: "должна быть от 2 до max_altitude метров"
  }, allow_nil: true
  validates :max_altitude, numericality: { greater_than_or_equal_to: MIN_ALTITUDE, less_than_or_equal_to: MAX_ALTITUDE }, allow_nil: true
  validates :speed, numericality: { greater_than_or_equal_to: 0, message: "не может быть отрицательной" }, allow_nil: true
  validates :sequence_number, numericality: { only_integer: true, greater_than_or_equal_to: 0 }, allow_nil: true

  validate :point_within_vineyard_zone
  validate :mission_accepts_route

  scope :for_mission, ->(mission_id) { where(mission_id: mission_id).order(:sequence_number) }
  scope :ordered, -> { order(:mission_id, :sequence_number) }

  private

  def set_max_altitude_if_blank
    self.max_altitude = MAX_ALTITUDE if max_altitude.blank?
  end

  def mission_accepts_route
    return if mission.blank?
    return if ALLOWED_MISSION_STATUSES_FOR_ROUTE.any? { |status_name| mission.public_send("#{status_name}?") }
    errors.add(:mission, "должна быть в статусе planned или approved для добавления точек маршрута")
  end

  def point_within_vineyard_zone
    return if latitude.nil? || longitude.nil?
    polygon = vineyard_polygon
    if polygon.empty?
      errors.add(:mission, "должна иметь зону с валидным полигоном boundary")
      return
    end
    # Точки до первой «внутри зоны» и после последней «внутри зоны» могут быть вне полигона (подлёт от базы, отлёт на базу)
    return if allowed_outside_zone?

    point = [longitude, latitude]
    return if point_in_polygon?(point, polygon)
    errors.add(:base, "Точка маршрута (широта #{latitude}, долгота #{longitude}) находится за пределами зоны виноградника")
  end

  # Полигон зоны берётся только из mission.zone.boundary
  def vineyard_polygon
    return [] if mission.blank?
    boundary = mission.zone&.boundary
    return [] if boundary.blank? || !boundary.is_a?(Array) || boundary.empty?
    boundary
  end

  # Разрешено быть вне зоны: все точки с sequence_number до первой внутренней и после последней внутренней
  def allowed_outside_zone?
    return true if mission.blank?
    first_inside, last_inside = first_and_last_inside_zone_sequence_numbers
    # Пока ни одна точка не внутри зоны — разрешаем все (подлёт к зоне)
    return true if first_inside.nil?
    # Нельзя определить порядок — требуем быть внутри
    return false if sequence_number.nil?
    # Вне зоны разрешены только "подлетные/возвратные" точки
    # до первого и после последнего вхождения в полигон.
    sequence_number < first_inside || sequence_number > last_inside
  end

  # [min sequence_number среди точек внутри зоны, max sequence_number среди точек внутри зоны]
  def first_and_last_inside_zone_sequence_numbers
    polygon = vineyard_polygon
    points = route_points_for_zone_validation
    inside_seqs = points.select do |p|
      p.latitude.present? && p.longitude.present? &&
        point_in_polygon?([p.longitude, p.latitude], polygon)
    end.map(&:sequence_number).compact
    [inside_seqs.min, inside_seqs.max]
  end

  # Все точки маршрута миссии с учётом текущей (в т.ч. новой) записи
  def route_points_for_zone_validation
    points = mission.routes.reload.to_a
    points << self if new_record? || points.none? { |p| p.id == id }
    points
  end

  def point_in_polygon?(point, polygon)
    # Ray-casting для проверки принадлежности точки полигону.
    x, y = point
    inside = false
    j = polygon.length - 1
    (0...polygon.length).each do |i|
      xi, yi = polygon[i]
      xj, yj = polygon[j]
      if ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)
        inside = !inside
      end
      j = i
    end
    inside
  end
end
