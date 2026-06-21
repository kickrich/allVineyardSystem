# frozen_string_literal: true

namespace :media_uploads do
  desc "Повторить finalize (processing) и отправку в VineyardApp (ready/failed) для видео миссий"
  task retry_pipeline: :environment do
    mission_id = ENV["MISSION_ID"].presence

    scope = MediaUpload.where(media_type: "video")
    scope = scope.where(mission_id: mission_id) if mission_id

    processing = scope.where(status: "processing")
    ready = scope.where(status: %w[ready failed])

    puts "processing: #{processing.count}, ready/failed: #{ready.count}"

    processing.find_each do |mu|
      puts "  finalize MediaUpload ##{mu.id} (mission ##{mu.mission_id})"
      MediaUploadTranscodeJob.perform_later(mu.id)
    end

    ready.find_each do |mu|
      if mu.status == "failed" && mu.url.present?
        mu.update_columns(status: "ready", error_message: nil, updated_at: Time.current)
      end
      puts "  send MediaUpload ##{mu.id} status=#{mu.status} error=#{mu.error_message.to_s.truncate(80)}"
      SendVideoToVineyardAppJob.perform_later(mu.id)
    end

    puts "Jobs enqueued. Смотрите: docker compose logs -f backend vineyard-app cv"
  end
end
