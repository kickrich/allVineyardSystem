class AddShiftSegmentIndicesToRouteTemplates < ActiveRecord::Migration[8.1]
  def change
    add_column :route_templates, :shift_segment_indices, :jsonb, default: [], null: false
  end
end
