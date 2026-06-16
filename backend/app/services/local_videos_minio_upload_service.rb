# frozen_string_literal: true

# Загрузка видео из LOCAL_VIDEOS_FOLDER напрямую в MinIO (без браузера).
class LocalVideosMinioUploadService
  class Error < StandardError; end

  def initialize(catalog: LocalVideosCatalogService.new, s3: S3MultipartUploadService.new)
    @catalog = catalog
    @s3 = s3
  end

  def upload_for_mission!(mission_id:, rows_count:, shift_segment_indices: [])
    mission = Mission.find_by(id: mission_id)
    raise Error, "Миссия не найдена" if mission.nil?
    unless mission_accepts_media?(mission)
      raise Error, "Миссия должна быть в статусе approved, in_progress или completed для приёма медиа"
    end
    unless @catalog.configured?
      raise Error, "Укажите LOCAL_VIDEOS_FOLDER в backend/.env (существующая папка с .mp4/.webm)"
    end

    files = @catalog.files_for_rows(rows_count)
    raise Error, "В каталоге нет видео для rows_count=#{rows_count}" if files.empty?

    normalized_shift_segments = normalize_shift_segment_indices(shift_segment_indices)
    normalized_rows_count = rows_count.to_i

    files.map do |file_meta|
      upload_one_file!(
        mission: mission,
        file_meta: file_meta,
        rows_count: normalized_rows_count,
        shift_segment_indices: normalized_shift_segments
      )
    end
  end

  private

  def mission_accepts_media?(mission)
    MediaUpload::ACCEPTED_MISSION_STATUSES.any? { |status_name| mission.public_send("#{status_name}?") }
  end

  def normalize_shift_segment_indices(raw)
    arr =
      case raw
      when Array
        raw
      when String
        begin
          JSON.parse(raw)
        rescue JSON::ParserError
          []
        end
      else
        []
      end

    arr
      .map { |v| Integer(v, exception: false) }
      .compact
      .select { |i| i >= 0 }
      .uniq
      .sort
  end

  def upload_one_file!(mission:, file_meta:, rows_count:, shift_segment_indices:)
    filename = file_meta[:name].to_s
    content_type = file_meta[:content_type].to_s
    byte_size = file_meta[:byte_size].to_i
    row_index = file_meta[:row_index]

    unless MediaUpload::ALLOWED_VIDEO_CONTENT_TYPES.include?(content_type)
      raise Error, "Недопустимый content_type для #{filename}: #{content_type}"
    end
    if byte_size <= 0
      raise Error, "Пустой файл: #{filename}"
    end
    if byte_size > MediaUpload::MAX_VIDEO_SIZE_BYTES
      raise Error, "Видео #{filename} слишком большое. Максимум #{MediaUpload::MAX_VIDEO_SIZE_BYTES / 1.megabyte} MB"
    end

    path = @catalog.safe_path_for(filename)
    session_id = SecureRandom.hex(16)
    key = build_multipart_key(mission_id: mission.id, session_id: session_id, filename: filename)

    @s3.upload_file(key: key, path: path, content_type: content_type)
    source_url = @s3.object_public_url(key)

    media_upload = MediaUpload.create!(
      mission_id: mission.id,
      media_type: "video",
      status: "processing",
      url: source_url,
      upload_session_id: session_id,
      upload_meta: {
        "storage" => "s3",
        "upload_mode" => "server_local_file",
        "key" => key,
        "source_key" => key,
        "source_url" => source_url,
        "filename" => filename,
        "content_type" => content_type,
        "byte_size" => byte_size,
        "row_index" => row_index,
        "rows_count" => rows_count,
        "shift_segment_indices" => shift_segment_indices
      }
    )

    MediaUploadTranscodeJob.perform_later(media_upload.id)

    {
      id: media_upload.id,
      mission_id: media_upload.mission_id,
      filename: filename,
      row_index: row_index,
      url: source_url,
      status: media_upload.status,
      byte_size: byte_size
    }
  end

  def build_multipart_key(mission_id:, session_id:, filename:)
    safe_filename = filename.gsub(/[^\w.\-]/, "_")
    "missions/#{mission_id}/uploads/#{session_id}/#{safe_filename}"
  end
end
