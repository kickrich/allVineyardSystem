# frozen_string_literal: true

class AddUserIdToZonesAndDrones < ActiveRecord::Migration[8.1]
  def up
    add_reference :zones, :user, foreign_key: true, null: true
    add_reference :drones, :user, foreign_key: true, null: true

    backfill_zones_user_id
    backfill_drones_user_id

    fallback_user_id = User.order(:id).pick(:id)
    if fallback_user_id
      Zone.where(user_id: nil).update_all(user_id: fallback_user_id)
      Drone.where(user_id: nil).update_all(user_id: fallback_user_id)
    end

    change_column_null :zones, :user_id, false if User.exists?
    change_column_null :drones, :user_id, false if User.exists?
  end

  def down
    remove_reference :drones, :user, foreign_key: true
    remove_reference :zones, :user, foreign_key: true
  end

  private

  def backfill_zones_user_id
    say_with_time "Backfill zones.user_id from missions" do
      execute <<~SQL.squish
        UPDATE zones
        SET user_id = sub.user_id
        FROM (
          SELECT DISTINCT ON (zone_id) zone_id, user_id
          FROM missions
          ORDER BY zone_id, id
        ) sub
        WHERE zones.id = sub.zone_id AND zones.user_id IS NULL
      SQL
    end
  end

  def backfill_drones_user_id
    say_with_time "Backfill drones.user_id from missions" do
      execute <<~SQL.squish
        UPDATE drones
        SET user_id = sub.user_id
        FROM (
          SELECT DISTINCT ON (drone_id) drone_id, user_id
          FROM missions
          ORDER BY drone_id, id
        ) sub
        WHERE drones.id = sub.drone_id AND drones.user_id IS NULL
      SQL
    end
  end
end
