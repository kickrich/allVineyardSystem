class CreateVideos < ActiveRecord::Migration[8.1]
  def change
    create_table :videos do |t|
      t.string :status
      t.string :original_filename
      t.datetime :recorded_at

      t.timestamps
    end
  end
end
