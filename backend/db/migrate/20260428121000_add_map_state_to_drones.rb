class AddMapStateToDrones < ActiveRecord::Migration[8.1]
  def change
    add_column :drones, :latitude, :float
    add_column :drones, :longitude, :float
    add_column :drones, :is_visible, :boolean, null: false, default: false
    add_column :drones, :route_path, :jsonb, null: false, default: []
  end
end
