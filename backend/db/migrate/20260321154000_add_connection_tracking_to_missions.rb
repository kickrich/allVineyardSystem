class AddConnectionTrackingToMissions < ActiveRecord::Migration[8.1]
  def change
    add_column :missions, :last_telemetry_at, :datetime
    add_column :missions, :lost_connection_at, :datetime
    add_column :missions, :connection_state, :string, null: false, default: "unknown"

    add_index :missions, [:status, :last_telemetry_at], name: "index_missions_on_status_and_last_telemetry_at"
  end
end
