class AddResumableUploadFieldsToMediaUploads < ActiveRecord::Migration[8.1]
  def change
    add_column :media_uploads, :upload_session_id, :string
    add_column :media_uploads, :upload_meta, :jsonb, default: {}

    add_index :media_uploads, :upload_session_id, unique: true
  end
end

