require 'rails_helper'

RSpec.describe Drone, type: :model do
  it "валиден с корректными данными" do
    drone = Drone.new(
      name: "Drone 1",
      model: "DJI",
      status: "idle",
      battery: 80
    )

    expect(drone).to be_valid
  end

  it "невалиден без имени" do
    drone = Drone.new(model: "DJI", status: "idle", battery: 50)
    expect(drone).not_to be_valid
  end

  it "невалиден если заряд больше 100" do
    drone = Drone.new(
      name: "Drone",
      model: "DJI",
      status: "idle",
      battery: 150
    )

    expect(drone).not_to be_valid
  end
end
