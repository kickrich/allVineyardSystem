class CreateVideoShards < ActiveRecord::Migration[8.1]
  def change
    create_table :video_shards do |t|
      t.references :video, null: false, foreign_key: true
      t.integer :shard_index, null: false
      t.string :original_filename
      t.integer :status, default: 0, null: false
      t.string :job_id
      t.datetime :recorded_at
      t.integer :bushes_count
      t.integer :gaps_count
      t.float :bush_spacing_avg
      t.float :row_spacing
      t.jsonb :result_json, default: {}

      t.timestamps
    end

    add_index :video_shards, [:video_id, :shard_index], unique: true
  end
end
