require "aws-sdk-s3"
require "securerandom"
require "uri"
require "cgi"

# Загрузка видео шарда в MinIO и сохранение object_key в result_json['source'].
class VideoShardMinioStorageService
  def initialize(shard)
    @shard = shard
  end

  def ensure_uploaded!
    source = current_source
    return source if source[:object_key].present?

    unless @shard.video_file.attached?
      raise "Нет прикреплённого файла для загрузки в MinIO"
    end

    object_key = upload_blob(@shard.video_file.blob)
    bucket = ENV.fetch("MINIO_BUCKET")
    persist_source!(
      object_key: object_key,
      bucket: bucket,
      uploaded_at: Time.current.iso8601(3)
    )
  end

  def current_source
    source = (@shard.result_json || {})["source"] || {}
    object_key = source["object_key"].to_s.presence
    bucket = source["bucket"].to_s.presence
    video_url = source["video_url"].to_s.presence

    if object_key.blank? && video_url.present?
      parsed_bucket, parsed_key = parse_key_from_url(video_url)
      object_key = parsed_key if parsed_key.present?
      bucket = parsed_bucket if bucket.blank? && parsed_bucket.present?
    end

    bucket ||= ENV["MINIO_BUCKET"].to_s.presence

    {
      object_key: object_key,
      bucket: bucket,
      video_url: video_url
    }
  end

  private

  def parse_key_from_url(video_url)
    uri = URI.parse(video_url)
    segments = uri.path.to_s.split("/").reject(&:blank?)
    return [nil, nil] if segments.size < 2

    bucket = CGI.unescape(segments.first)
    key = CGI.unescape(segments[1..].join("/"))
    [bucket, key]
  rescue URI::InvalidURIError
    [nil, nil]
  end

  def persist_source!(**attrs)
    payload = (@shard.result_json || {}).dup
    source = (payload["source"] || {}).dup
    source.merge!(attrs.stringify_keys)
    payload["source"] = source
    @shard.update!(result_json: payload)
    source.symbolize_keys
  end

  def upload_blob(blob)
    s3 = s3_client
    bucket = ENV.fetch("MINIO_BUCKET")
    ensure_bucket!(s3, bucket)

    object_key = "video-shards/#{@shard.video_id}/#{@shard.id}/#{SecureRandom.uuid}-#{blob.filename}"

    blob.open do |file|
      if File.size(file.path).zero?
        raise "Файл шарда имеет нулевой размер"
      end

      s3.put_object(
        bucket: bucket,
        key: object_key,
        body: file,
        content_type: blob.content_type || "video/mp4"
      )
    end

    Rails.logger.info(
      "[VideoShardMinioStorage] shard_id=#{@shard.id} uploaded key=#{object_key} bucket=#{bucket}"
    )
    object_key
  rescue Aws::S3::Errors::ServiceError => e
    raise "Ошибка загрузки в MinIO: #{e.message}"
  end

  def s3_client
    Aws::S3::Client.new(
      endpoint: ENV.fetch("MINIO_ENDPOINT"),
      region: ENV.fetch("MINIO_REGION", "us-east-1"),
      access_key_id: ENV.fetch("MINIO_ACCESS_KEY"),
      secret_access_key: ENV.fetch("MINIO_SECRET_KEY"),
      force_path_style: true
    )
  end

  def ensure_bucket!(s3, bucket)
    s3.head_bucket(bucket: bucket)
  rescue Aws::S3::Errors::NotFound, Aws::S3::Errors::NoSuchBucket
    s3.create_bucket(bucket: bucket)
  end
end
