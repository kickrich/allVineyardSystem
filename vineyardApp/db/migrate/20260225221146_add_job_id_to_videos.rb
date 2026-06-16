class AddJobIdToVideos < ActiveRecord::Migration[8.1]
  def change
    add_column :videos, :job_id, :string
  end
end
