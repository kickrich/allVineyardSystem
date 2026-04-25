class CreateRouteTemplates < ActiveRecord::Migration[8.1]
  def change
    create_table :route_templates do |t|
      t.string :name, null: false
      t.jsonb :path, null: false, default: []
      t.references :user, null: false, foreign_key: true
      t.references :zone, null: true, foreign_key: { on_delete: :nullify }

      t.timestamps
    end

    add_index :route_templates, [:user_id, :name]
  end
end
