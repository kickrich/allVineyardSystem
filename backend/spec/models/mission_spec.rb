require 'rails_helper'

RSpec.describe Mission, type: :model do
  let(:user) do
    User.create!(
      name: "User",
      email: "user@test.com",
    )
  end

  let(:drone) do
    Drone.create!(
      name: "Drone",
      model: "DJI",
      status: "idle",
      battery: 90
    )
  end

  it "создаётся с валидными данными" do
    mission = Mission.new(
      mission_type: "mapping",
      drone: drone,
      user: user,
      status: "planned"
    )

    expect(mission).to be_valid
  end
end
