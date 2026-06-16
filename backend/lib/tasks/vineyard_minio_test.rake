# frozen_string_literal: true

# Тест: положить короткое mp4 в MinIO (S3_* из .env), создать MediaUpload и отправить шард в VineyardApp.
#
# Требования:
#   - MinIO запущен (docker compose из корня репо: cv + minio, или отдельно)
#   - backend .env: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, VINEYARD_APP_URL
#   - vineyardApp запущен, MINIO_* совпадают с бакетом backend
#   - ffmpeg в PATH (генерирует 1 сек тестового видео)
#
# Примеры:
#   MISSION_ID=1 bin/rails vineyard:minio_test_video
#   MISSION_ID=1 SYNC_SEND=1 bin/rails vineyard:minio_test_video   # без очереди: сразу HTTP в VineyardApp
#
namespace :vineyard do
  desc "Загрузить тестовое mp4 в MinIO и опционально отправить в VineyardApp"
  task minio_test_video: :environment do
    mission_id = ENV.fetch("MISSION_ID", nil)
    if mission_id.blank?
      puts "Укажите MISSION_ID=число (миссия должна быть completed или сначала завершите её)."
      puts "Пример: MISSION_ID=1 bin/rails vineyard:minio_test_video"
      exit 1
    end

    mission = Mission.find_by(id: mission_id.to_i)
    if mission.nil?
      puts "Миссия ##{mission_id} не найдена."
      exit 1
    end

    unless mission.completed?
      if mission.in_progress?
        puts "Завершаю миссию ##{mission.id}..."
        mission.complete!
      else
        puts "Миссия должна быть in_progress (чтобы завершить) или completed. Сейчас: #{mission.status}."
        exit 1
      end
    end

    service = S3MultipartUploadService.new
    key = "test-pipeline/mission-#{mission.id}/#{Time.now.to_i}-test.mp4"

    Dir.mktmpdir("vineyard_minio_test") do |dir|
      mp4_path = File.join(dir, "test.mp4")
      unless system("ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=1",
                    "-pix_fmt", "yuv420p", "-c:v", "libx264", "-t", "1", mp4_path,
                    out: File::NULL, err: File::NULL)
        puts "Ошибка: нужен ffmpeg в PATH для генерации тестового mp4."
        puts "Установите ffmpeg и повторите."
        exit 1
      end

      service.upload_file(key: key, path: mp4_path, content_type: "video/mp4")
      url = service.object_public_url(key)
      puts "Файл в MinIO: bucket=#{ENV.fetch('S3_BUCKET', nil)} key=#{key}"
      puts "URL: #{url}"

      meta = { "mp4_key" => key, "source_key" => key, "source_url" => url }
      now = Time.current

      # insert_all! без callbacks — чтобы не дублировать job; отправка ниже при SYNC_SEND=1
      MediaUpload.insert_all!([
        {
          mission_id: mission.id,
          media_type: "video",
          status: "ready",
          url: url,
          upload_meta: meta,
          created_at: now,
          updated_at: now,
          error_message: nil,
          upload_session_id: nil
        }
      ])

      mu = MediaUpload.where(mission_id: mission.id).order(id: :desc).first
      puts "MediaUpload ##{mu.id} создан (status=ready)."

      if ENV["SYNC_SEND"] == "1"
        puts "SYNC_SEND=1 — отправка в VineyardApp синхронно..."
        vid = SendVideoToVineyardAppService.new(mu).send
        if vid
          puts "Успех. vineyard_app_video_id на миссии: #{mission.reload.vineyard_app_video_id}"
          mu.update_column(:status, "sent_to_vineyard")
        else
          puts "Отправка не удалась (см. лог). MediaUpload ##{mu.id} остаётся ready."
          exit 1
        end
      else
        SendVideoToVineyardAppJob.perform_later(mu.id)
        puts "В очередь поставлен SendVideoToVineyardAppJob для MediaUpload ##{mu.id}."
        puts "Запусти воркер: bin/jobs (solid_queue) или bin/rails solid_queue:start — либо SYNC_SEND=1 для синхронной отправки."
      end
    end
  rescue S3MultipartUploadService::ConfigError => e
    puts "S3/MinIO не настроен: #{e.message}"
    puts "Проверьте S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY в .env"
    exit 1
  rescue Aws::S3::Errors::ServiceError => e
    puts "Ошибка S3/MinIO: #{e.message}"
    exit 1
  end
end
