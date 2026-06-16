class AddVineyardAppIntegrationToMissions < ActiveRecord::Migration[8.1]
  def change
    add_column :missions, :vineyard_app_video_id, :integer
    add_column :missions, :vineyard_app_callback_url, :string
    add_column :missions, :vineyard_app_callback_token, :string
  end
end
