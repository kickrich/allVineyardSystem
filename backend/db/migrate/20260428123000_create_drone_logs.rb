class CreateDroneLogs < ActiveRecord::Migration[8.1]
  def change
    create_table :drone_logs do |t|
      t.references :user, null: false, foreign_key: true
      t.references :drone, null: true, foreign_key: true
      t.string :message, null: false
      t.jsonb :data, null: false, default: {}
      t.datetime :logged_at, null: false

      t.timestamps
    end

    add_index :drone_logs, :logged_at
  end
end
