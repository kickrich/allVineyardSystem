class ChangeStatusInVideos < ActiveRecord::Migration[8.1]
  def change
    remove_column :videos, :status, :string
    add_column :videos, :status, :integer, default: 0, null: false
  end
end
