require 'rails_helper'

RSpec.describe "Drones API", type: :request do
  let!(:drone) do
    Drone.create!(
      name: "Drone 1",
      model: "DJI",
      status: "idle",
      battery: 100
    )
  end

  it "возвращает список дронов" do
    get "/api/v1/drones"
    expect(response).to have_http_status(:ok)
  end

  it "создаёт дрон" do
    post "/api/v1/drones", params: {
      drone: {
        name: "Drone 2",
        model: "DJI Mini",
        status: "idle",
        battery: 80
      }
    }

    expect(response).to have_http_status(:created)
    expect(Drone.count).to eq(2)
  end

  it "удаляет дрон" do
    delete "/api/v1/drones/#{drone.id}"
    expect(response).to have_http_status(:no_content)
  end
end
