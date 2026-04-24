# db/migrate/20260225_create_zones.rb

class CreateZones < ActiveRecord::Migration[8.1]
  def change
    create_table :zones do |t|
      t.string :name, null: false
      t.text :description
      t.jsonb :boundary, default: []  # например, полигон из точек

      t.timestamps
    end

    add_reference :missions, :zone, foreign_key: true
  end
end
