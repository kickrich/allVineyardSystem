class CreateTelemetries < ActiveRecord::Migration[8.1]
  def change
    create_table :telemetries do |t|
      t.references :mission, null: false, foreign_key: true
      t.datetime :recorded_at
      t.float :latitude
      t.float :longitude
      t.float :altitude
      t.float :speed
      t.integer :battery

      t.timestamps
    end
  end
end
