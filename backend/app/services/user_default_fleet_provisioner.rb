# frozen_string_literal: true

# Стартовый набор дронов для нового пользователя (как на фронте в drones_data.js).
class UserDefaultFleetProvisioner
  DEFAULT_FLEET = [
    { name: "Дрон-1", model: "DJI Mavic 3" },
    { name: "Дрон-2", model: "DJI Mini 3" },
    { name: "Дрон-3", model: "DJI Air 3" },
    { name: "Дрон-4", model: "DJI Phantom 4" },
    { name: "Дрон-5", model: "DJI Mavic 3 Pro" }
  ].freeze

  def self.ensure!(user)
    new(user).ensure!
  end

  def initialize(user)
    @user = user
  end

  def ensure!
    return @user.drones.order(:id) if @user.drones.exists?

    DEFAULT_FLEET.each do |attrs|
      @user.drones.create!(
        name: attrs[:name],
        model: attrs[:model],
        status: :idle,
        battery: 100,
        is_visible: false,
        route_path: [],
        shift_segment_indices: []
      )
    end

    @user.drones.order(:id)
  end
end
