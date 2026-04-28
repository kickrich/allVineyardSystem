class AddShiftSegmentIndicesToDrones < ActiveRecord::Migration[8.1]
  def change
    add_column :drones, :shift_segment_indices, :jsonb, null: false, default: []
  end
end
