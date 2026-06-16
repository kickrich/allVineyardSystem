# frozen_string_literal: true

class AddMaxAltitudeToRoutes < ActiveRecord::Migration[8.1]
  def change
    add_column :routes, :max_altitude, :float
  end
end
