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

ActiveRecord::Schema[8.1].define(version: 2026_03_25_120000) do
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

  create_table "detections", force: :cascade do |t|
    t.float "bush_spacing_avg"
    t.integer "bushes_count"
    t.datetime "created_at", null: false
    t.integer "gaps_count"
    t.jsonb "result_json"
    t.float "row_spacing"
    t.datetime "updated_at", null: false
    t.bigint "video_id", null: false
    t.index ["video_id"], name: "index_detections_on_video_id"
  end

  create_table "video_shards", force: :cascade do |t|
    t.float "bush_spacing_avg"
    t.integer "bushes_count"
    t.datetime "created_at", null: false
    t.integer "gaps_count"
    t.string "job_id"
    t.string "original_filename"
    t.datetime "recorded_at"
    t.jsonb "result_json", default: {}
    t.float "row_spacing"
    t.integer "shard_index", null: false
    t.integer "status", default: 0, null: false
    t.datetime "updated_at", null: false
    t.bigint "video_id", null: false
    t.index ["video_id", "shard_index"], name: "index_video_shards_on_video_id_and_shard_index", unique: true
    t.index ["video_id"], name: "index_video_shards_on_video_id"
  end

  create_table "videos", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "external_callback_token", comment: "Токен для безопасности колбэка"
    t.string "external_service_url", comment: "URL сервиса для отправки результатов"
    t.string "mission_id", comment: "ID миссии от внешнего сервиса"
    t.string "name"
    t.datetime "recorded_at"
    t.integer "status", default: 0, null: false
    t.datetime "updated_at", null: false
    t.index ["mission_id"], name: "index_videos_on_mission_id", unique: true
  end

  add_foreign_key "active_storage_attachments", "active_storage_blobs", column: "blob_id"
  add_foreign_key "active_storage_variant_records", "active_storage_blobs", column: "blob_id"
  add_foreign_key "detections", "videos"
  add_foreign_key "video_shards", "videos"
end
