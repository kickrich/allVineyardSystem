# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_04_26_180500) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "active_storage_attachments", force: :cascade do |t|
    t.bigint "blob_id", null: false
    t.datetime "created_at", null: false
    t.string "name", null: false
    t.bigint "record_id", null: false
    t.string "record_type", null: false
    t.index ["blob_id"], name: "index_active_storage_attachments_on_blob_id"
    t.index ["record_type", "record_id", "name", "blob_id"], name: "index_active_storage_attachments_uniqueness", unique: true
  end

  create_table "active_storage_blobs", force: :cascade do |t|
    t.bigint "byte_size", null: false
    t.string "checksum"
    t.string "content_type"
    t.datetime "created_at", null: false
    t.string "filename", null: false
    t.string "key", null: false
    t.text "metadata"
    t.string "service_name", null: false
    t.index ["key"], name: "index_active_storage_blobs_on_key", unique: true
  end

  create_table "active_storage_variant_records", force: :cascade do |t|
    t.bigint "blob_id", null: false
    t.string "variation_digest", null: false
    t.index ["blob_id", "variation_digest"], name: "index_active_storage_variant_records_uniqueness", unique: true
  end

  create_table "ai_results", force: :cascade do |t|
    t.float "avg_distance_between_bushes"
    t.float "avg_distance_between_rows"
    t.integer "bushes_count"
    t.datetime "created_at", null: false
    t.integer "mission_id", null: false
    t.jsonb "result_json"
    t.integer "rows_count"
    t.string "status"
    t.datetime "updated_at", null: false
    t.index ["mission_id"], name: "index_ai_results_on_mission_id"
  end

  create_table "drones", force: :cascade do |t|
    t.integer "battery"
    t.datetime "created_at", null: false
    t.string "model"
    t.string "name"
    t.string "status"
    t.datetime "updated_at", null: false
  end

  create_table "media_uploads", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.text "error_message"
    t.string "media_type"
    t.integer "mission_id", null: false
    t.string "status", default: "uploaded", null: false
    t.datetime "updated_at", null: false
    t.jsonb "upload_meta", default: {}
    t.string "upload_session_id"
    t.string "url"
    t.index ["mission_id"], name: "index_media_uploads_on_mission_id"
    t.index ["status"], name: "index_media_uploads_on_status"
    t.index ["upload_session_id"], name: "index_media_uploads_on_upload_session_id", unique: true
  end

  create_table "missions", force: :cascade do |t|
    t.string "connection_state", default: "unknown", null: false
    t.datetime "created_at", null: false
    t.integer "drone_id", null: false
    t.datetime "last_telemetry_at"
    t.datetime "lost_connection_at"
    t.string "mission_type"
    t.string "status"
    t.datetime "updated_at", null: false
    t.integer "user_id", null: false
    t.string "vineyard_app_callback_token"
    t.string "vineyard_app_callback_url"
    t.integer "vineyard_app_video_id"
    t.bigint "zone_id", null: false
    t.index ["drone_id"], name: "index_missions_on_drone_id"
    t.index ["status", "last_telemetry_at"], name: "index_missions_on_status_and_last_telemetry_at"
    t.index ["user_id"], name: "index_missions_on_user_id"
    t.index ["zone_id"], name: "index_missions_on_zone_id"
  end

  create_table "route_templates", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "name", null: false
    t.jsonb "path", default: [], null: false
    t.jsonb "shift_segment_indices", default: [], null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.bigint "zone_id"
    t.index ["user_id", "name"], name: "index_route_templates_on_user_id_and_name"
    t.index ["user_id"], name: "index_route_templates_on_user_id"
    t.index ["zone_id"], name: "index_route_templates_on_zone_id"
  end

  create_table "routes", force: :cascade do |t|
    t.float "altitude"
    t.datetime "created_at", null: false
    t.float "latitude"
    t.float "longitude"
    t.float "max_altitude"
    t.integer "mission_id", null: false
    t.integer "sequence_number"
    t.float "speed"
    t.datetime "updated_at", null: false
    t.index ["mission_id"], name: "index_routes_on_mission_id"
  end

  create_table "telemetries", force: :cascade do |t|
    t.float "altitude"
    t.integer "battery"
    t.datetime "created_at", null: false
    t.float "latitude"
    t.float "longitude"
    t.integer "mission_id", null: false
    t.datetime "recorded_at"
    t.float "speed"
    t.datetime "updated_at", null: false
    t.index ["mission_id"], name: "index_telemetries_on_mission_id"
  end

  create_table "users", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "email"
    t.string "name"
    t.string "password_digest"
    t.datetime "updated_at", null: false
  end

  create_table "zones", force: :cascade do |t|
    t.jsonb "boundary", default: []
    t.string "color", default: "#22c55e", null: false
    t.datetime "created_at", null: false
    t.text "description"
    t.string "name", null: false
    t.datetime "updated_at", null: false
  end

  add_foreign_key "active_storage_attachments", "active_storage_blobs", column: "blob_id"
  add_foreign_key "active_storage_variant_records", "active_storage_blobs", column: "blob_id"
  add_foreign_key "ai_results", "missions"
  add_foreign_key "media_uploads", "missions"
  add_foreign_key "missions", "drones"
  add_foreign_key "missions", "users"
  add_foreign_key "missions", "zones"
  add_foreign_key "route_templates", "users"
  add_foreign_key "route_templates", "zones", on_delete: :nullify
  add_foreign_key "routes", "missions"
  add_foreign_key "telemetries", "missions"
end
