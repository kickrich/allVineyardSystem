class CreateRoutes < ActiveRecord::Migration[8.1]
  def change
    create_table :routes do |t|
      t.references :mission, null: false, foreign_key: true
      t.float :latitude
      t.float :longitude
      t.float :altitude
      t.float :speed

      t.timestamps
    end
  end
end
