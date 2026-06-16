class CreateAiResults < ActiveRecord::Migration[8.1]
  def change
    create_table :ai_results do |t|
      t.references :mission, null: false, foreign_key: true
      t.string :status
      t.integer :bushes_count
      t.integer :rows_count
      t.float :avg_distance_between_rows
      t.float :avg_distance_between_bushes

      t.timestamps
    end
  end
end
