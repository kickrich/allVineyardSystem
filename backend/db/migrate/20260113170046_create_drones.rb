class CreateDrones < ActiveRecord::Migration[8.1]
  def change
    create_table :drones do |t|
      t.string :name
      t.string :model
      t.string :status
      t.integer :battery

      t.timestamps
    end
  end
end
