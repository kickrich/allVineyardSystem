class ChangeVideosModel < ActiveRecord::Migration[8.1]
  def change
    remove_column :videos, :job_id, :string
    rename_column :videos, :original_filename, :name
  end
end
