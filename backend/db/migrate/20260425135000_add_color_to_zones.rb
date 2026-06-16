class AddColorToZones < ActiveRecord::Migration[8.1]
  def up
    return if column_exists?(:zones, :color)

    add_column :zones, :color, :string
  end

  def down
    return unless column_exists?(:zones, :color)

    remove_column :zones, :color
  end
end
