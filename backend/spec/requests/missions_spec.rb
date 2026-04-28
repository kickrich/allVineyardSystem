require 'rails_helper'

RSpec.describe "Missions API", type: :request do
  let!(:user) do
    User.create!(
      name: "User",
      email: "user@test.com",
    )
  end

  let!(:drone) do
    Drone.create!(
      name: "Drone",
      model: "DJI",
      status: "idle",
      battery: 90
    )
  end

  it "создаёт миссию для свободного дрона" do
  post "/api/v1/missions", params: {
    mission: {
      mission_type: "mapping",
      drone_id: drone.id,
      user_id: user.id
    }
  }

  expect(response).to have_http_status(:created)

  mission = Mission.last
  expect(mission.status).to eq("approved")
expect(drone.reload.status).to eq("idle")

end

  it "не позволяет создать миссию для занятого дрона" do
    drone.update(status: "in_mission")

    post "/api/v1/missions", params: {
      mission: {
        mission_type: "mapping",
        drone_id: drone.id,
        user_id: user.id
      }
    }

    expect(response).to have_http_status(:unprocessable_entity)
  end
end
