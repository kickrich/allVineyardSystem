require "open3"
require "tmpdir"
require "shellwords"

class MediaUploadTranscodeJob < ApplicationJob
  queue_as :default

  # Конвертируем webm → mp4 и кладём mp4 рядом в S3/MinIO.
  def perform(media_upload_id)
    media_upload = MediaUpload.find_by(id: media_upload_id)
    return if media_upload.nil?

    meta = media_upload.upload_meta || {}
    source_key = meta["key"].to_s
    return if source_key.blank?

    service = S3MultipartUploadService.new

    Dir.mktmpdir("media_upload_transcode") do |dir|
      source_path = File.join(dir, "source.webm")
      out_path = File.join(dir, "out.mp4")

      service.download_to_file(key: source_key, path: source_path)

      ffmpeg_cmd = [
        ffmpeg_binary,
        "-y",
        "-i", source_path,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        out_path
      ]

      _stdout, stderr, status = Open3.capture3(*ffmpeg_cmd)
      unless status.success?
        # Fallback: если ffmpeg не смог сконвертировать, продолжаем с исходным webm.
        promote_source_as_ready!(media_upload, meta, service)
        return
      end

      mp4_key = build_mp4_key(source_key)
      service.upload_file(key: mp4_key, path: out_path, content_type: "video/mp4")

      next_meta = meta.merge(
        "source_key" => source_key,
        "source_url" => service.object_public_url(source_key),
        "mp4_key" => mp4_key
      )

      media_upload.update!(
        status: "ready",
        url: service.object_public_url(mp4_key),
        upload_meta: next_meta,
        error_message: nil
      )
    end
  rescue Errno::ENOENT => e
    # Fallback: ffmpeg не установлен в окружении backend.
    media_upload = MediaUpload.find_by(id: media_upload_id)
    if media_upload
      service = S3MultipartUploadService.new
      meta = media_upload.upload_meta || {}
      promote_source_as_ready!(media_upload, meta, service)
    else
      MediaUpload.where(id: media_upload_id).update_all(status: "failed", error_message: e.message)
    end
  rescue S3MultipartUploadService::ConfigError => e
    MediaUpload.where(id: media_upload_id).update_all(status: "failed", error_message: e.message)
  rescue StandardError => e
    MediaUpload.where(id: media_upload_id).update_all(status: "failed", error_message: e.message)
  end

  private

  def build_mp4_key(source_key)
    base = source_key.sub(/\.(webm|mp4)\z/i, "")
    "#{base}.mp4"
  end

  def ffmpeg_binary
    custom = ENV["FFMPEG_PATH"].to_s.strip
    return custom unless custom.empty?
    "ffmpeg"
  end

  def promote_source_as_ready!(media_upload, meta, service)
    source_key = meta["source_key"].to_s.presence || meta["key"].to_s
    source_url = meta["source_url"].to_s.presence || service.object_public_url(source_key)
    next_meta = meta.merge(
      "source_key" => source_key,
      "source_url" => source_url
    )

    media_upload.update!(
      status: "ready",
      url: source_url,
      upload_meta: next_meta,
      error_message: nil
    )
  end
end

