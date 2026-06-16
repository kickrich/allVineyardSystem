class MakeZoneRequiredForMissions < ActiveRecord::Migration[8.1]
  class Mission < ApplicationRecord
    self.table_name = "missions"
  end

  class Zone < ApplicationRecord
    self.table_name = "zones"
  end

  def up
    default_zone = Zone.find_or_create_by!(name: "Default vineyard zone") do |zone|
      zone.description = "Auto-created to backfill missions without zone."
      zone.boundary = []
    end

    Mission.where(zone_id: nil).update_all(zone_id: default_zone.id)
    change_column_null :missions, :zone_id, false
  end

  def down
    change_column_null :missions, :zone_id, true
  end
end
