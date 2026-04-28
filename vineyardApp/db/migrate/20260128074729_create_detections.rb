class CreateDetections < ActiveRecord::Migration[8.1]
  def change
    create_table :detections do |t|
      t.references :video, null: false, foreign_key: true
      t.integer :bushes_count
      t.integer :gaps_count
      t.float :row_spacing
      t.float :bush_spacing_avg
      t.jsonb :result_json

      t.timestamps
    end
  end
end
