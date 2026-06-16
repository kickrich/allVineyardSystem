class CreateMediaUploads < ActiveRecord::Migration[8.1]
  def change
    create_table :media_uploads do |t|
      t.references :mission, null: false, foreign_key: true
      t.string :media_type
      t.string :url

      t.timestamps
    end
  end
end
