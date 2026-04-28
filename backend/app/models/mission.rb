class Mission < ApplicationRecord
  # Минимальный заряд для перевода миссии в in_progress.
  MIN_START_BATTERY_PERCENT = 10
  # Набор статусов, которые считаются "активными" в фильтрах и проверках.
  ACTIVE_STATUSES = %i[planned approved in_progress].freeze
  # Явная матрица допустимых переходов статусов.
  VALID_STATUS_TRANSITIONS = {
    "planned" => %w[approved cancelled],
    "approved" => %w[in_progress cancelled],
    "in_progress" => %w[completed cancelled],
    "completed" => [],
    "cancelled" => []
  }.freeze

  belongs_to :drone
  belongs_to :user
  belongs_to :zone

  has_many :routes, dependent: :destroy
  has_many :telemetries, dependent: :destroy
  has_many :media_uploads, dependent: :destroy
  has_one  :ai_result, dependent: :destroy

  # Интеграция с VineyardApp
  attribute :vineyard_app_callback_token, :string, default: -> { SecureRandom.hex(32) }

  MISSION_TYPES = %w[monitoring].freeze
  STATUSES = %w[planned approved in_progress completed cancelled].freeze
  CONNECTION_STATES = %w[unknown online lost].freeze
  TELEMETRY_TIMEOUT_SECONDS = 45
  LOST_LINK_CANCEL_TIMEOUT_SECONDS = 10.minutes

  enum :status, {
    planned: "planned",
    approved: "approved",
    in_progress: "in_progress",
    completed: "completed",
    cancelled: "cancelled"
  }
  enum :connection_state, {
    unknown: "unknown",
    online: "online",
    lost: "lost"
  }, prefix: :connection

  before_validation :set_default_status, on: :create
  before_validation :strip_mission_type
  after_destroy :free_drone_if_needed

  validates :drone, presence: { message: "должен быть указан" }
  validates :user, presence: { message: "должен быть указан" }
  validates :zone, presence: { message: "должна быть указана" }
  validates :status, presence: true,
                    inclusion: { in: STATUSES, message: "должен быть один из: planned, approved, in_progress, completed, cancelled" }
  validates :connection_state, inclusion: { in: CONNECTION_STATES, message: "должен быть: unknown, online или lost" }
  validates :mission_type, length: { maximum: 50 }, allow_nil: true
  validates :mission_type, inclusion: { in: MISSION_TYPES, message: "должен быть: monitoring"}, if: :mission_type_present?

  validate :drone_must_be_idle, on: :create
  validate :drone_availability_on_creation, on: :create
  validate :sufficient_battery_to_start, if: :in_progress?
  validate :valid_status_transition, on: :update

  validates :vineyard_app_video_id, uniqueness: { allow_nil: true }

  scope :by_status, ->(s) { where(status: s) }
  scope :active, -> { where(status: ACTIVE_STATUSES) }
  scope :for_drone, ->(drone_id) { where(drone_id: drone_id) }
  scope :for_user, ->(user_id) { where(user_id: user_id) }

  def can_start?
    approved? && drone.idle? && routes.exists? && has_route_point_inside_zone?
  end

  def can_complete?
    in_progress?
  end

  def active?
    planned? || approved? || in_progress?
  end

  def start!(actor: nil)
    raise "Миссия должна быть одобрена (approved)" unless approved?
    raise "Дрон должен быть свободен (idle)" unless drone.idle?
    raise "Нельзя запустить миссию без маршрута. Добавьте хотя бы одну точку." if routes.empty?
    raise "Нельзя запустить миссию: маршрут должен содержать хотя бы одну точку внутри зоны." unless has_route_point_inside_zone?

    transaction do
      update!(status: :in_progress, connection_state: :online, lost_connection_at: nil)
      drone.update!(status: :in_mission)
    end
  end

  def complete!(actor: nil)
    raise "Миссия не в статусе in_progress" unless in_progress?

    transaction do
      update!(status: :completed)
      drone.update!(status: :idle)
    end
  end

  def register_telemetry!(at: Time.current)
    telemetry_time = at.presence || Time.current

    transaction do
      attrs = { last_telemetry_at: telemetry_time }
      if in_progress?
        attrs[:connection_state] = :online
        attrs[:lost_connection_at] = nil
      end
      update!(attrs)
      drone.update!(status: :in_mission) if in_progress? && drone.offline?
    end
  end

  def mark_connection_lost!(at: Time.current)
    return unless in_progress?
    return if connection_lost?

    transaction do
      update!(connection_state: :lost, lost_connection_at: at)
      drone.update!(status: :offline) unless drone.offline?
    end
  end

  def cancel_due_to_lost_link!(at: Time.current)
    return unless in_progress?
    return unless connection_lost?

    transaction do
      update!(status: :cancelled, lost_connection_at: at)
      drone.update!(status: :offline) unless drone.offline?
    end
  end

  def self.mark_lost_connections!(timeout_seconds: TELEMETRY_TIMEOUT_SECONDS, now: Time.current)
    cutoff = now - timeout_seconds
    where(status: :in_progress)
      .where("last_telemetry_at IS NULL OR last_telemetry_at < ?", cutoff)
      .find_each do |mission|
      mission.mark_connection_lost!(at: now)
    end
  end

  def self.cancel_stale_lost_connections!(cancel_timeout_seconds: LOST_LINK_CANCEL_TIMEOUT_SECONDS, now: Time.current)
    cutoff = now - cancel_timeout_seconds
    where(status: :in_progress, connection_state: :lost)
      .where("lost_connection_at IS NOT NULL AND lost_connection_at < ?", cutoff)
      .find_each do |mission|
      mission.cancel_due_to_lost_link!(at: now)
    end
  end

  def self.process_connection_timeouts!(
    lost_timeout_seconds: TELEMETRY_TIMEOUT_SECONDS,
    cancel_timeout_seconds: LOST_LINK_CANCEL_TIMEOUT_SECONDS,
    now: Time.current
  )
    # Шаг 1: помечаем потерю связи, если давно нет телеметрии.
    mark_lost_connections!(timeout_seconds: lost_timeout_seconds, now: now)
    # Шаг 2: отменяем "зависшие" миссии со статусом lost.
    cancel_stale_lost_connections!(cancel_timeout_seconds: cancel_timeout_seconds, now: now)
  end

  private

  def mission_type_present?
    mission_type.present?
  end

  def set_default_status
    self.status = self.class.statuses.fetch(:planned) if status.blank?
  end

  def strip_mission_type
    self.mission_type = mission_type.to_s.strip.presence if mission_type.present?
  end

  def drone_must_be_idle
    return if drone.nil? || drone.idle?
    errors.add(:drone, "должен быть в статусе idle для назначения на миссию")
  end

  def drone_availability_on_creation
    return if drone.nil?
    return unless drone.missions.active.exists?
    errors.add(:drone, "уже назначен на активную или запланированную миссию")
  end

  def free_drone_if_needed
    return unless drone
    drone.update(status: :idle) if drone.in_mission?
  end

  def sufficient_battery_to_start
    return if drone.nil?
    return if drone.battery.present? && drone.battery >= MIN_START_BATTERY_PERCENT
    errors.add(:base, "Заряд батареи дрона слишком низкий для старта (минимум #{MIN_START_BATTERY_PERCENT}%)")
  end

  def user_not_busy
    return if user.nil?
    return unless user.missions.where(status: :in_progress).exists?
    errors.add(:user, "уже управляет другой активной миссией")
  end

  def valid_status_transition?
    return true if status_was == status
    VALID_STATUS_TRANSITIONS[status_was]&.include?(status)
  end

  def valid_status_transition
    return if valid_status_transition?
    errors.add(:status, "нельзя изменить с «#{status_was}» на «#{status}». Допустимые переходы: planned → approved → in_progress → completed")
  end

  def has_route_point_inside_zone?
    polygon = zone_polygon
    return false if polygon.empty?

    routes.any? do |route_point|
      route_point.latitude.present? &&
        route_point.longitude.present? &&
        point_in_polygon?([route_point.longitude, route_point.latitude], polygon)
    end
  end

  def zone_polygon
    boundary = zone&.boundary
    return [] if boundary.blank? || !boundary.is_a?(Array) || boundary.empty?
    boundary
  end

  def point_in_polygon?(point, polygon)
    # Алгоритм ray-casting: считаем пересечения луча с ребрами полигона.
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

  public

  # Интеграция с VineyardApp
  def vineyard_app_url
    ENV.fetch('VINEYARD_APP_URL', 'http://localhost:3000')
  end

  def vineyard_app_callback_url
    "#{vineyard_app_url}/api/missions/create"
  end

  def vineyard_app_video_created?
    vineyard_app_video_id.present?
  end

  def create_video_in_vineyard_app!(video_name: nil)
    return if vineyard_app_video_created?

    conn = Faraday.new(url: vineyard_app_url) do |f|
      f.request :json
      f.adapter Faraday.default_adapter
      f.options.timeout = 30
    end

    response = conn.post('/api/missions/create') do |req|
      req.body = {
        mission_id: id,
        name: video_name || "Миссия ##{id} - #{drone&.name} - #{created_at&.strftime('%Y-%m-%d %H:%M')}",
        callback_url: "#{vineyard_app_url}/api/missions/#{id}/results",
        callback_token: vineyard_app_callback_token
      }.to_json
    end

    if response.status.in?(200..299)
      data = JSON.parse(response.body)
      update!(vineyard_app_video_id: data['video_id'])
      data['video_id']
    else
      raise "Failed to create video in VineyardApp: #{response.status} - #{response.body}"
    end
  rescue => e
    Rails.logger.error("[Mission##{id}] VineyardApp integration error: #{e.message}")
    raise
  end

  def send_results_to_vineyard_app!(results)
    conn = Faraday.new(url: vineyard_app_url) do |f|
      f.request :json
      f.adapter Faraday.default_adapter
      f.options.timeout = 30
    end

    response = conn.post("/api/missions/#{id}/results") do |req|
      req.headers['Authorization'] = "Bearer #{vineyard_app_callback_token}"
      req.body = results.to_json
    end

    if response.status.in?(200..299)
      true
    else
      Rails.logger.error("[Mission##{id}] Failed to send results: #{response.status} - #{response.body}")
      false
    end
  rescue => e
    Rails.logger.error("[Mission##{id}] Send results error: #{e.message}")
    false
  end
end