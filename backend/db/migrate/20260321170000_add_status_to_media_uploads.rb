class AddStatusToMediaUploads < ActiveRecord::Migration[8.1]
  def change
    add_column :media_uploads, :status, :string, null: false, default: "uploaded"
    add_column :media_uploads, :error_message, :text
    add_index :media_uploads, :status
  end
end
