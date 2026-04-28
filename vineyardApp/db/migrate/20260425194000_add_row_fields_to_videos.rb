class AddRowFieldsToVideos < ActiveRecord::Migration[8.1]
  def up
    add_column :videos, :row_index, :integer unless column_exists?(:videos, :row_index)
    add_column :videos, :rows_count, :integer unless column_exists?(:videos, :rows_count)

    if index_exists?(:videos, :mission_id, unique: true, name: "index_videos_on_mission_id")
      remove_index :videos, name: "index_videos_on_mission_id"
    end

    unless index_exists?(:videos, [:mission_id, :row_index], name: "index_videos_on_mission_id_and_row_index")
      add_index :videos, [:mission_id, :row_index], name: "index_videos_on_mission_id_and_row_index", unique: true
    end

    unless index_exists?(:videos, :mission_id, name: "index_videos_on_mission_id")
      add_index :videos, :mission_id, name: "index_videos_on_mission_id"
    end
  end

  def down
    remove_index :videos, name: "index_videos_on_mission_id_and_row_index" if index_exists?(:videos, [:mission_id, :row_index], name: "index_videos_on_mission_id_and_row_index")
    remove_index :videos, name: "index_videos_on_mission_id" if index_exists?(:videos, :mission_id, name: "index_videos_on_mission_id")
    add_index :videos, :mission_id, name: "index_videos_on_mission_id", unique: true unless index_exists?(:videos, :mission_id, unique: true, name: "index_videos_on_mission_id")

    remove_column :videos, :rows_count if column_exists?(:videos, :rows_count)
    remove_column :videos, :row_index if column_exists?(:videos, :row_index)
  end
end
